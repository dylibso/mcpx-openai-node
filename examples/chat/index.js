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
  const messages = [];

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
