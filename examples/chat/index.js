import { McpxOpenAI } from '@dylibso/mcpx-openai';
import readline from 'readline'
import OpenAI from 'openai'
import pino from 'pino'
import pretty from 'pino-pretty'
import fs from "node:fs"

const logger = pino(pretty({ colorize: true }))

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function main() {
  const mcpx = await McpxOpenAI.create({
    openai,
    logger,
    sessionId: process.env['MCP_RUN_SESSION_ID']
  })

  const messages = [{
    role: 'system',
    content: `
You are a helpful AI assistant with access to various external tools and APIs. Your goal is to complete tasks thoroughly and autonomously by making full use of these tools. Here are your core operating principles:

1. Take initiative - Don't wait for user permission to use tools. If a tool would help complete the task, use it immediately.
2. Chain multiple tools together - Many tasks require multiple tool calls in sequence. Plan out and execute the full chain of calls needed to achieve the goal.
3. Handle errors gracefully - If a tool call fails, try alternative approaches or tools rather than asking the user what to do.
4. Make reasonable assumptions - When tool calls require parameters, use your best judgment to provide appropriate values rather than asking the user.
5. Show your work - After completing tool calls, explain what you did and show relevant results, but focus on the final outcome the user wanted.
6. Be thorough - Use tools repeatedly as needed until you're confident you've fully completed the task. Don't stop at partial solutions.

Your responses should focus on results rather than asking questions. Only ask the user for clarification if the task itself is unclear or impossible with the tools available.
`,
  }];

  console.log('Chat started. Type "exit" to quit.\n');

  while (true) {
    const input = await new Promise(resolve => rl.question('You: ', resolve));

    if (input.toLowerCase() === 'exit') {
      console.log('Goodbye!');
      rl.close();
      break;
    }

    messages.push({ role: 'user', content: input });

    let response = await mcpx.chatCompletionCreate({
      model: 'gpt-4-turbo',
      temperature: 0,
      messages,
    });

    let responseMessage = response.choices[0]?.message;
    console.log("\nAssistant:", responseMessage.content);

    //optionally write message log
    //fs.writeFileSync('./messages.json', JSON.stringify(messages, null, 4))
  }
}

async function runWithErrorHandling() {
  try {
    await main();
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      console.error('OpenAI API Error:', error.message);
      console.error('Error status:', error.status);
      console.error('Error code:', error.code);
      console.error('Error type:', error.type);
    } else {
      console.error('Unexpected error:', error);
    }
  }
}

 runWithErrorHandling();
