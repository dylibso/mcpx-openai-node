import type { ChatCompletion, ChatCompletionMessage, ChatCompletionMessageParam, ChatCompletionMessageToolCall, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/index.js';
import { Session, type SessionOptions } from '@dylibso/mcpx';
import type { RequestOptions } from 'openai/core';
import { pino, type Logger } from 'pino';
import OpenAI from 'openai';

export interface BaseMcpxOpenAIOptions {
  logger?: Logger;
  openai: OpenAI;
}

export type McpxOpenAIOptions = (
  (BaseMcpxOpenAIOptions & { sessionId: string, profile?: string, sessionOptions: SessionOptions }) |
  (BaseMcpxOpenAIOptions & { session: Session })
)

export interface McpxOpenAITurn {
  messages: ChatCompletionMessageParam[]
  index: number
  toolCallIndex?: number
  done: boolean
  response: ChatCompletion
}

export interface McpxOpenAIStage {
  messages: ChatCompletionMessageParam[]
  index: number
  toolCallIndex?: number
  status: 'ready' | 'pending' | 'input_wait'
  response: ChatCompletion
}

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

    let response: ChatCompletion
    let messageIdx = 1
    do {
      const result =
        await this.nextTurn({
          ...rest,
          ...(this.#tools.length ? { tools: this.#tools } : {}),
          messages,
        }, messageIdx, options)

      response = result.response
      messages = result.messages
      messageIdx = result.index
      if (result.done) {
        break
      }
    } while (1)
    return response
  }

  private logFinalMessage(messageIdx: number, messages: ChatCompletionMessageParam[]) {
    for (; messageIdx < messages.length - 1; ++messageIdx) {
      this.#logger.info({ exchange: messages[messageIdx] }, 'message')
    }
    this.#logger.info({ lastMessage: messages[messageIdx] }, 'final message')
  }

  async nextTurn(
    body: ChatCompletionCreateParamsNonStreaming,
    messageIdx: number,
    options?: RequestOptions<unknown> | undefined,
  ): Promise<McpxOpenAITurn> {

    let { messages, ...rest } = body

    let stage: McpxOpenAIStage = {
      messages,
      index: messageIdx,
      status: 'pending',
      response: {} as ChatCompletion,
    }

    stage = await this.next(stage, rest, options)
    switch (stage.status) {
      case 'ready':
        return {
          messages: stage.messages,
          index: stage.index,
          response: stage.response,
          done: true,
        }
      case 'pending':
        return {
          messages: stage.messages,
          index: stage.index,
          response: stage.response,
          done: false,
        }
      case 'input_wait':
        do {
          stage = await this.next(stage, rest, options)
        } while (stage.status === 'input_wait')
        return {
          messages: stage.messages,
          index: stage.index,
          response: stage.response,
          done: stage.status === 'ready',
        }
    }
  }

  async next(stage: McpxOpenAIStage, config: any, requestOptions?: RequestOptions<unknown>): Promise<McpxOpenAIStage> {
    const { response, messages, index, status } = stage

    // Read the current message in the batch.
    switch (status) {
      case 'pending': {
        let response: ChatCompletion
        try {
          response = await this.#openai.chat.completions.create({
            ...config,
            ...(this.#tools.length ? { tools: this.#tools } : {}),
            messages,
          }, requestOptions)
        } catch (err: any) {
          throw ToolSchemaError.parse(err)
        }

        // Note: `response.choices.length` is always 1 if option `n` is 1
        const choice = response.choices.slice(-1)[0]
        if (!choice) {
          this.logFinalMessage(index, messages)
          return { response, messages, index, status: 'ready' }
        }

        const message = choice.message
        messages.push(message)
        // There are no tool calls.
        if (!message.tool_calls) {
          this.logFinalMessage(index, messages)
          return { response, messages, index, status: 'ready' }
        }

        let messageIdx = index
        for (; messageIdx < messages.length; ++messageIdx) {
          this.#logger.info({ exchange: messages[messageIdx] }, 'message')
        }
        return { response, messages, index: messageIdx, status: 'input_wait', toolCallIndex: 0 }
      }
      case 'input_wait': {
        const toolCallIndex = stage.toolCallIndex!
        const inputMessage = messages[index-1]
        this.#logger.info({ m:"message index", index, len: messages.length })

        const message = inputMessage as ChatCompletionMessage
        const toolCalls = message.tool_calls!
        const tool = toolCalls[toolCallIndex]

        this.#logger.info(toolCalls)

        if (tool.type !== 'function') {
          return { response, messages, index, status: 'pending' }
        }

        messages.push(await this.call(tool))
        const nextTool = toolCallIndex + 1
        if (nextTool >= toolCalls.length) {
          return { response, messages, index, status: 'pending' }
        } else {
          return { response, messages, index, status: 'input_wait', toolCallIndex: toolCallIndex + 1 }
        }
      }
      default:
        throw new Error("Illegal status: " + status)
    }
  }

  private async call(tool: ChatCompletionMessageToolCall): Promise<ChatCompletionMessageParam> {
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
        { signal: abortcontroller.signal },
      )

      return {
        role: 'tool',
        content: JSON.stringify(result),
        tool_call_id: tool.id,
      }
    } catch (err: any) {
      return {
        role: 'tool',
        content: err.toString(),
        tool_call_id: tool.id,
      }
    }
  }
}

export class ToolSchemaError extends Error {
  static parse(err: any): any {
    console.log(JSON.stringify(err))
    const error = err?.error
    const code = error?.code
    if (error?.type === 'invalid_request_error' && code === 'invalid_function_parameters') {
      // e.g. tools[0].function.parameters
      const regex = /tools\[(\d+)\]\.function\.parameters/;
      const match = error.param?.match(regex);
      if (match) {
        const index = parseInt(match[1], 10) || -1
        return new ToolSchemaError(err, index)
      }
    }
    return err
  }

  public readonly originalError: any
  public readonly toolIndex: number
  constructor(error: any, index: number) {
    super(error.message)
    this.originalError = error;
    this.toolIndex = index;
  }

}


