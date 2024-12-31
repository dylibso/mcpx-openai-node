import OpenAI from 'openai';
import readline from 'readline'
import type { ChatCompletionMessageParam } from 'openai/resources';
import { Session } from './session.ts'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function main() {
  const session = await Session.create({ openai })
  const messages: Array<ChatCompletionMessageParam> = [];

  console.log('Chat started. Type "exit" to quit.\n');

  while (true) {
    const input = await new Promise<string>(resolve => rl.question('You: ', resolve));

    if (input.toLowerCase() === 'exit') {
      console.log('Goodbye!');
      rl.close();
      break;
    }

    messages.push({ role: 'user', content: input });
    let response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages,
      tools: session.tools,
    });

    response = await session.handleToolCalls(response, messages)
    console.log(response)
  }
}

// Error handling wrapper
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
