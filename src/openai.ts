import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/index.js';
import { Session, type SessionOptions } from '@dylibso/mcpx';
import type { RequestOptions } from 'openai/core';
import { pino, Logger } from 'pino';
import OpenAI from 'openai';

export interface BaseMcpxOpenAIOptions {
  logger?: Logger;
  openai: OpenAI;
}

export type McpxOpenAIOptions = (
  (BaseMcpxOpenAIOptions & { sessionId: string, profile?: string, sessionOptions: SessionOptions }) |
  (BaseMcpxOpenAIOptions & { session: Session })
)

interface OpenAITool {
  type: 'function',
  function: {
    name: string
    description?: string
    parameters?: any
  }
}

// implement a wrapper around openai chat completions api
// i want to be able to intercept the `create` call and provide the same interface
// as openai
export class McpxOpenAI {
  #openai: OpenAI;
  #session: Session;
  #tools: OpenAITool[];
  #logger: Logger;

  private constructor(openai: OpenAI, session: Session, tools: OpenAITool[], logger: Logger) {
    this.#openai = openai
    this.#session = session
    this.#logger = logger
    this.#tools = tools
  }

  async close() {
    await this.#session.close()
  }

  static async create(opts: McpxOpenAIOptions) {
    const { openai, logger } = opts
    const session: Session = (
      !('session' in opts)
        ? new Session(Object.assign({}, {
          authentication: [
            ["cookie", `sessionId=${opts.sessionId}`]
          ] as [string, string][],
          activeProfile: opts.profile ?? 'default',
          ...(opts.sessionOptions || {})
        }))
        : opts.session
    )

    const { tools: mcpTools } = await session.handleListTools({} as any, {} as any)
    const tools = mcpTools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }))

    return new McpxOpenAI(openai, session, tools, logger || (session.logger as any) || pino({ level: 'silent' }))
  }

  async chatCompletionCreate(
    body: ChatCompletionCreateParamsNonStreaming,
    options?: RequestOptions<unknown> | undefined
  ): Promise<ChatCompletion> {
    let { messages, ...rest } = body

    let response: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>>
    let messageIdx = 1
    do {
      response = await this.#openai.chat.completions.create({
        ...rest,
        ...(this.#tools.length ? { tools: this.#tools } : {}),
        messages,
      }, options)

      const choice = response.choices.slice(-1)[0]
      if (!choice) {
        break
      }

      messages.push(choice.message)
      if (!choice.message.tool_calls) {
        break
      }

      for (; messageIdx < messages.length; ++messageIdx) {
        this.#logger.info({ exchange: messages[messageIdx] }, 'message')
      }

      for (const tool of choice.message.tool_calls) {
        if (tool.type !== 'function') {
          continue
        }

        try {
          const abortcontroller = new AbortController()
          const result = await this.#session.handleCallTool(
            {
              method: 'tools/call',
              params: {
                name: tool.function.name,
                arguments: JSON.parse(tool.function.arguments),
              },
            },
            { signal: abortcontroller.signal }
          )

          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: tool.id,
          })
        } catch (err: any) {
          messages.push({
            role: 'tool',
            content: err.toString(),
            tool_call_id: tool.id,
          })
        }
      }
    } while (1)
    for (; messageIdx < messages.length - 1; ++messageIdx) {
      this.#logger.info({ exchange: messages[messageIdx] }, 'message')
    }
    this.#logger.info({ lastMessage: messages[messageIdx] }, 'final message')
    return response
  }
}

