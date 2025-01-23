import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources';
import { Session } from './session';
import type { RequestOptions } from 'openai/core';
import { Logger } from 'pino';

export interface McpxOpenAIOptions {
  openai: OpenAI;
  sessionId: string;
  profile?: string;
  logger?: Logger
}

// implement a wrapper around openai chat completions api
// i want to be able to intercept the `create` call and provide the same interface
// as openai
export class McpxOpenAI {
  #openai: OpenAI;
  #session: Session;

  private constructor(openai: OpenAI, session: Session) {
    this.#openai = openai
    this.#session = session
  }

  static async create(opts: McpxOpenAIOptions) {
    const {openai, logger, sessionId, profile } = opts
    const config = {
      authentication: [
        ["cookie", `sessionId=${sessionId}`]
      ] as [string, string][],
      profile: profile ?? 'default',
    }
    const session = await Session.create({
      config,
      logger,
    })

    return new McpxOpenAI(openai, session) 
  }

  async chatCompletionCreate(
    body: ChatCompletionCreateParamsNonStreaming,
    options?: RequestOptions<unknown> | undefined
  ): Promise<ChatCompletion> {
    let { messages } = body

    // inherit any given tools
    let tools = this.#session.tools
    if (body.tools) {
      tools = tools.concat(body.tools)
    }
    let tool_choice = body.tool_choice ?? 'auto'

    let response = await this.#openai.chat.completions.create({
      tools,
      tool_choice,
      ...body
    }, options)
    if (!response.choices[0]?.message) return response

    // TODO: make this auto-handling configurable
    while (true) {
      let responseMessage = response.choices[0]?.message;
      const toolCalls = responseMessage.tool_calls
      messages.push(responseMessage);

      // if we have no tool calls, or are done, break the loop
      if (!toolCalls) {
        return response;
      }

      // else we need to invoke the tool calls until they are all gone

      const toolPromises = toolCalls.map(async toolCall => {
        if (toolCall.type !== 'function') {
          console.warn('We do not support non-function calls');
          return;
        }

        console.info(toolCall)
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
        } catch (e: any) {
          console.error(`Error calling tool: ${e}`)
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

      // call completion again with the results of the tool calls
      response = await this.#openai.chat.completions.create({tools, ...body}, options)
    }
  }
}

