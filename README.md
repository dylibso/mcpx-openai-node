# MCPX OpenAI Client

This library allows you connect your [OpenAI](https://openai.com) models to
[mcp.run](https://mcp.run) and expose your installed servlets as tools which can be 
invoked in process (without spinning up many server processes).

It accomplishes this by bundling an [MCP](https://modelcontextprotocol.io/introduction)
client, server, and our [wasm technology](https://www.getxtp.com/).

## Usage

### Install

You just need the mcpx-openai library and the openai library (if you don't already have it).

```
npm install @dylibso/mcpx-openai openai --save
```

### Code

McpxOpenAI presents as a wrapper around the [OpenAI Node](https://github.com/openai/openai-node) library.

```typescript
import OpenAI from "openai";
import McpxOpenAI from "@dylibso/mcpx-openai"

async function main() {
    // Create your OpenAI client as normal
    const openai = new OpenAI({
      apiKey: process.env['OPENAI_API_KEY'],
    })

    // Wrap with McpxOpenAI
    const mcpx = await McpxOpenAI.create(openai)

    // call any tool compatible api, e.g chat completion:
    // let's ask it to evalute some javascript. If you have
    // this tool installed: https://www.mcp.run/bhelx/eval-js it should
    // determine and use this to evaluate it in a sandbox
    const messages = [];
    messages.push({
      role: 'user',
      content: `
          Write a djb2hash function in javascript and evalute it on the string "Hello, World!"
      `
    })

    // this will automatically process all tool calls
    // until there are none left
    let response = await mcpx.chatCompletionCreate({
      model: 'gpt-4o',
      messages,
    });

    console.log(response.choices[0]?.message)
    //=> The DJB2 hash of the string "Hello, World!" is `-1763540338`.
}

main()
```

### Examples

* [Example chat application](examples/chat)

