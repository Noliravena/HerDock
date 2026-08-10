import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

lines.on("line", (line) => {
  if (!line.trim()) return;

  const message = JSON.parse(line);
  if (message.id == null) return;

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "herdock-fake-mcp", version: "1.0.0" },
      },
    });
  } else if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo test arguments",
            inputSchema: { type: "object" },
            annotations: { readOnlyHint: true },
          },
          {
            name: "hang",
            description: "Never responds",
            inputSchema: { type: "object" },
          },
        ],
      },
    });
  } else if (message.method === "tools/call" && message.params.name === "echo") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          { type: "text", text: JSON.stringify(message.params.arguments || {}) },
        ],
        isError: false,
      },
    });
  }
});
