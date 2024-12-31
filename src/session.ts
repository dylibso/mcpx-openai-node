import OpenAI from 'openai';
import { Session as McpxSession } from '@dylibso/mcpx'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import pino from 'pino'
import pretty from 'pino-pretty'
import { xdgConfig } from 'xdg-basedir'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import open from 'open'
import type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources';

export interface SessionConfig {
  authentication?: [string, string][]
  profile?: string
}

export interface SessionOptions {
  // TODO make required
  config?: SessionConfig;
  openai: OpenAI;
}

const logger = pino(
  { level: process.env.LOG_LEVEL || 'info' },
  process.env.DEV_SERVER_ORIGIN ? pretty({ colorize: true }) : process.stderr
)
const config = await loadConfig()
async function loadConfig(): Promise<SessionConfig> {
  if (!xdgConfig) {
    throw new Error('need xdg_config')
  }

  try {
    const source = await readFile(
      path.join(xdgConfig, 'mcpx', 'config.json'),
      'utf8'
    )
    return JSON.parse(source)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return {}
    }
    throw err
  }
}

export class Session {
  #config: SessionConfig;
  #openai: OpenAI;
  #session: McpxSession;
  tools: ChatCompletionTool[];

  private constructor(opts: SessionOptions) {
    this.#config = opts.config || config
    this.#openai = opts.openai
  }

  static async create(opts: SessionOptions) {
    const s = new Session(opts)
    await s.load()
    return s
  }

  async load() {
    const server = new Server(
      {
        name: "mcpx",
        version: "0.0.1",
      },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true, subscribe: true },
          prompts: { listChanged: true },
        },
      }
    )

    this.#session = await McpxSession.attachToServer(server, {
      authentication: config.authentication,
      logger,
      opener: open,
      activeProfile: this.#config.profile || 'default',
    })

    // this.#session.onlogin = () => {
    //   this.#config.authentication = [...this.#session.client.authentication || []]
    //   void saveConfig(this.#config)
    // }

    const clientTransport = new InMemoryTransport()
    const serverTransport = new InMemoryTransport()
    // @ts-ignore
    clientTransport._otherTransport = serverTransport
    // @ts-ignore
    serverTransport._otherTransport = clientTransport

    const client = new Client({
      name: "mcpx-client",
      version: "1.0.0",
    }, {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true, subscribe: true },
        prompts: { listChanged: true },
      },
    });

    // NOTE: order important, connect server first, then client
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    // map mcp tool descriptions to openai
    // TODO: skipping invalid notion tool note to fix
    const mcpTools = (await client.listTools()).tools.filter(t => t.name != 'notion_notion_query_database')
    this.tools = mcpTools.map(t => ({
      type: "function" as const,
      ["function"]: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      }
    }));
  }

  async handleToolCalls(response: ChatCompletion, messages: ChatCompletionMessageParam[]): Promise<ChatCompletion> {
    if (!response.choices[0]?.message) return response

    // we're going to keep looping until we're out of tool calls
    while (true) {
      let responseMessage = response.choices[0]?.message;
      const toolCalls = responseMessage.tool_calls

      // if we have no tool calls, or are done, break the loop
      if (!toolCalls) {
        console.log('\nAssistant:', responseMessage.content);
        messages.push(responseMessage);
        return response;
      }

      // else we need to invoke the tool calls until they are all gone
      messages.push(responseMessage);

      logger.info(`Remaining tool calls: ${JSON.stringify(toolCalls)}`);

      const toolPromises = toolCalls.map(async toolCall => {
        if (toolCall.type !== 'function') {
          logger.warn('We do not support non-function calls');
          return;
        }

        try {
          // process the tool call using mcpx
          const toolResp = await this.#session.handleCallTool({
            params: {
              name: toolCall.function.name,
              arguments: JSON.parse(toolCall.function.arguments),
            }
          });
          messages.push({
            role: 'tool',
            content: JSON.stringify(toolResp),
            tool_call_id: toolCall.id
          });
        } catch (e) {
          logger.error(`Error in tool call for ${toolCall.id}: ${e}`);
          // tell openai what the error is
          messages.push({
            role: 'tool',
            content: e.toString(),
            tool_call_id: toolCall.id
          });
        }
      });

      // wait for all the tool calls to finish
      await Promise.all(toolPromises);

      // TODO inherit these options from somewhere, should it instead
      // pass in a callback?
      response = await this.#openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages,
        tools: this.tools,
      });
    }
  }
}
