import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startAgentServer, type RunningAgentServer } from "../../src/server/index.js";
import type { LLMClient } from "../../src/llm/types.js";
import { McpManager } from "../../src/mcp/client.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Minimal stub LLMClient — just satisfies the type; these tests don't exercise real LLM.
function stubClient(): LLMClient {
  return {
    async chat() {
      return { message: { role: "assistant", content: "stub" }, toolUses: [] };
    },
  } as unknown as LLMClient;
}

describe("startAgentServer", () => {
  let home: string;
  let prevHome: string | undefined;
  let server: RunningAgentServer | undefined;
  let client: Client | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "startserver-test-"));
    prevHome = process.env.AMAN_AGENT_HOME;
    process.env.AMAN_AGENT_HOME = home;
  });

  afterEach(async () => {
    try {
      await client?.close();
    } catch {
      /* best effort */
    }
    try {
      await server?.stop();
    } catch {
      /* best effort */
    }
    client = undefined;
    server = undefined;
    if (prevHome === undefined) delete process.env.AMAN_AGENT_HOME;
    else process.env.AMAN_AGENT_HOME = prevHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  it("exposes agent.info, agent.delegate, agent.send and registers in the registry", async () => {
    const mcpManager = new McpManager(); // empty — no connections
    server = await startAgentServer({
      name: "test-agent",
      profile: "default",
      client: stubClient(),
      mcpManager,
    });

    // Verify registry entry landed
    const registryContent = JSON.parse(
      await fs.readFile(path.join(home, "registry.json"), "utf-8"),
    );
    expect(registryContent).toHaveLength(1);
    expect(registryContent[0].name).toBe("test-agent");
    expect(registryContent[0].port).toBe(server.entry.port);
    expect(registryContent[0].token).toBe(server.entry.token);

    // Connect a real MCP client
    const url = new URL(`http://127.0.0.1:${server.entry.port}/mcp`);
    const clientTransport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${server.entry.token}` } },
    });
    client = new Client({ name: "test-caller", version: "0.1.0" });
    await client.connect(clientTransport);

    // listTools returns exactly the three tools
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(["agent.delegate", "agent.info", "agent.send"]);

    // agent.info returns InfoResult shape
    const infoResult = await client.callTool({ name: "agent.info", arguments: {} });
    const infoText = Array.isArray(infoResult.content)
      ? (infoResult.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("")
      : "";
    const info = JSON.parse(infoText);
    expect(info.name).toBe("test-agent");
    expect(info.profile).toBe("default");
    expect(info.pid).toBe(process.pid);
    expect(info.pending_inbox).toBe(0);
    expect(typeof info.version).toBe("string");

    // agent.send enqueues
    const sendResult = await client.callTool({
      name: "agent.send",
      arguments: { from: "tester", body: "hello from integration test" },
    });
    const sendText = Array.isArray(sendResult.content)
      ? (sendResult.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("")
      : "";
    const send = JSON.parse(sendText);
    expect(send.ok).toBe(true);

    // After send, info shows pending_inbox: 1
    const info2Result = await client.callTool({ name: "agent.info", arguments: {} });
    const info2Text = Array.isArray(info2Result.content)
      ? (info2Result.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("")
      : "";
    const info2 = JSON.parse(info2Text);
    expect(info2.pending_inbox).toBe(1);

    // After stop, registry entry is removed
    await server.stop();
    server = undefined;
    const registryAfter = JSON.parse(
      await fs.readFile(path.join(home, "registry.json"), "utf-8"),
    );
    expect(registryAfter).toHaveLength(0);
  }, 15_000);
});
