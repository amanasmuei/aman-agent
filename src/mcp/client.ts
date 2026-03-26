import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";

interface McpConnection {
  name: string;
  client: Client;
  transport: StdioClientTransport;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  serverName: string;
}

export class McpManager {
  private connections: McpConnection[] = [];
  private tools: ToolDef[] = [];

  async connect(
    name: string,
    command: string,
    args: string[],
  ): Promise<void> {
    try {
      const transport = new StdioClientTransport({ command, args, stderr: "pipe" });
      const client = new Client({
        name: `aman-agent-${name}`,
        version: "0.1.0",
      });
      await client.connect(transport);

      // Redirect stderr to debug log instead of terminal
      if (transport.stderr) {
        transport.stderr.on("data", (chunk: Buffer) => {
          log.debug("mcp", `[${name} stderr] ${chunk.toString().trim()}`);
        });
      }

      this.connections.push({ name, client, transport });

      // List tools from this server
      const toolsResult = await client.listTools();
      for (const tool of toolsResult.tools) {
        this.tools.push({
          name: tool.name,
          description: tool.description || "",
          input_schema: tool.inputSchema as Record<string, unknown>,
          serverName: name,
        });
      }
    } catch (err) {
      log.error("mcp", "Failed to connect to " + name + " MCP server", err);
      console.error(`  Warning: Could not connect to ${name} MCP server`);
    }
  }

  getTools(): ToolDef[] {
    return this.tools;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) return `Error: tool ${toolName} not found`;

    const conn = this.connections.find((c) => c.name === tool.serverName);
    if (!conn) return `Error: server ${tool.serverName} not connected`;

    try {
      const result = await withRetry(
        () => conn.client.callTool({ name: toolName, arguments: args }),
        { maxAttempts: 2, baseDelay: 500, retryable: (err) => err.message.includes("ETIMEDOUT") || err.message.includes("timeout") },
      );
      // Extract text from result
      if (result.content && Array.isArray(result.content)) {
        return (result.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
      }
      return JSON.stringify(result);
    } catch (error) {
      return `Error calling ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async disconnect(): Promise<void> {
    for (const conn of this.connections) {
      try {
        await conn.client.close();
      } catch (err) {
        log.debug("mcp", "Cleanup error disconnecting " + conn.name, err);
      }
    }
    this.connections = [];
    this.tools = [];
  }
}
