import { Session as McpxSession } from '@dylibso/mcpx'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Logger } from 'pino'
import { xdgConfig } from 'xdg-basedir'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources';

export interface SessionConfig {
  authentication?: [string, string][]
  profile?: string
}

export interface SessionOptions {
  // TODO make required
  config?: SessionConfig;
  logger?: Logger;
}

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

export interface CreateCallbackOptions {
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
}

export interface HandleToolCallOptions {
  response: ChatCompletion;
  messages: ChatCompletionMessageParam[];
  createCallback: (opts: CreateCallbackOptions) => Promise<ChatCompletion>;
}

export class Session {
  #config?: SessionConfig;
  #session: McpxSession;
  #logger?: Logger;
  //@ts-ignore
  tools: ChatCompletionTool[];

  private constructor(opts: SessionOptions) {
    this.#config = opts.config
    this.#logger = opts.logger
  }

  static async create(opts: SessionOptions) {
    const s = new Session(opts)
    await s.load()
    return s
  }

  async handleCallTool(opts: any) {
    return this.#session.handleCallTool(opts)
  }

  async load() {
    //const config = this.#config || await loadConfig()
    const config = this.#config || await loadConfig()

    // we need an MCP client and server to get started
    const capabilities = {
      tools: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
      prompts: { listChanged: true },
    }
    const server = new Server({
        name: "mcpx-server",
        version: "0.0.1",
      }, { capabilities })
    const client = new Client({
      name: "mcpx-client",
      version: "0.0.1",
    }, { capabilities })

    this.#session = await McpxSession.attachToServer(server, {
      authentication: config.authentication,
      logger: this.#logger,
      builtInTools: [],
      activeProfile: config.profile || 'default',
    })

    // NOTE: We don't need this because we're expecting an authed session

    // this.#session.onlogin = () => {
    //   this.#config.authentication = [...this.#session.client.authentication || []]
    //   void saveConfig(this.#config)
    // }

    // here is some magic that creates a fake MCP bridge in memory b/w client and server
    const clientTransport = new InMemoryTransport()
    const serverTransport = new InMemoryTransport()
    // @ts-ignore
    clientTransport._otherTransport = serverTransport
    // @ts-ignore
    serverTransport._otherTransport = clientTransport

    // NOTE: order important, connect server first, then client
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const mcpTools = (await client.listTools()).tools
    this.tools = mcpTools.map(t => ({
      type: "function" as const,
      ["function"]: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      }
    }));
  }

}
