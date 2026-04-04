import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";

interface McpConnection {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  /** Original params stored for reconnect */
  connectParams: { command: string; args: string[]; env?: Record<string, string> };
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  serverName: string;
}

const TOOL_CALL_TIMEOUT_MS = 30_000;

export class McpManager {
  private connections: McpConnection[] = [];
  private tools: ToolDef[] = [];

  async connect(
    name: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    try {
      const transport = new StdioClientTransport({
        command,
        args,
        stderr: "pipe",
        env: env ? env : undefined,
      });
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

      this.connections.push({ name, client, transport, connectParams: { command, args, env } });

      // List tools from this server
      const toolsResult = await client.listTools();
      for (const tool of toolsResult.tools) {
        // Fix 4: Warn on tool name collisions
        const existing = this.tools.find((t) => t.name === tool.name);
        if (existing) {
          log.warn(
            "mcp",
            `Warning: tool "${tool.name}" from server "${name}" shadows existing tool from "${existing.serverName}"`,
          );
        }

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

    const executeTool = async () => {
      const currentConn = this.connections.find((c) => c.name === tool.serverName);
      if (!currentConn) throw new Error(`Server ${tool.serverName} disconnected`);

      const result = await Promise.race([
        currentConn.client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool ${toolName} timed out after 30s`)),
            TOOL_CALL_TIMEOUT_MS,
          ),
        ),
      ]);

      if (result.content && Array.isArray(result.content)) {
        return (result.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
      }
      return JSON.stringify(result);
    };

    try {
      return await withRetry(executeTool, {
        maxAttempts: 2,
        baseDelay: 500,
        retryable: (err) => err.message.includes("ETIMEDOUT") || err.message.includes("timeout"),
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Detect connection failures and auto-reconnect once
      const isConnectionError = errMsg.includes("EPIPE") || errMsg.includes("ECONNRESET") ||
        errMsg.includes("channel closed") || errMsg.includes("disconnected") ||
        errMsg.includes("not connected") || errMsg.includes("write after end") ||
        errMsg.includes("socket hang up") || errMsg.includes("spawn");
      if (isConnectionError) {
        log.warn("mcp", `Connection error for ${tool.serverName}, attempting reconnect: ${errMsg}`);
        try {
          await this.reconnect(tool.serverName);
          return await executeTool();
        } catch (reconnectErr) {
          return `Error calling ${toolName}: reconnect failed — ${reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr)}`;
        }
      }
      return `Error calling ${toolName}: ${errMsg}`;
    }
  }

  async reconnect(name: string): Promise<void> {
    const connIndex = this.connections.findIndex((c) => c.name === name);
    if (connIndex === -1) {
      log.error("mcp", `Cannot reconnect: no connection found for "${name}"`);
      return;
    }

    const conn = this.connections[connIndex];
    const { command, args, env } = conn.connectParams;

    // Kill old connection
    try {
      await conn.client.close();
    } catch (err) {
      log.debug("mcp", `Error closing old connection for ${name}`, err);
    }

    // Remove old connection and its tools
    this.connections.splice(connIndex, 1);
    this.tools = this.tools.filter((t) => t.serverName !== name);

    // Re-connect with same params
    await this.connect(name, command, args, env);
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
