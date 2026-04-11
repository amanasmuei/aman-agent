import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { startAgentServer, type RunningAgentServer } from "../src/server/index.js";
import type { LLMClient } from "../src/llm/types.js";
import { McpManager } from "../src/mcp/client.js";
import { delegateRemote } from "../src/delegate-remote.js";
import { log } from "../src/logger.js";

function stubClient(): LLMClient {
  return {
    async chat() {
      return { message: { role: "assistant", content: "[stub reply]" }, toolUses: [] };
    },
  } as unknown as LLMClient;
}

describe("delegateRemote", () => {
  let home: string;
  let prevHome: string | undefined;
  let server: RunningAgentServer | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "delegate-remote-test-"));
    prevHome = process.env.AMAN_AGENT_HOME;
    process.env.AMAN_AGENT_HOME = home;
  });

  afterEach(async () => {
    try {
      await server?.stop();
    } catch {
      /* best effort */
    }
    server = undefined;
    if (prevHome === undefined) delete process.env.AMAN_AGENT_HOME;
    else process.env.AMAN_AGENT_HOME = prevHome;
    await fs.rm(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("happy path: dials a running server and returns a successful DelegationResult", async () => {
    server = await startAgentServer({
      name: "target",
      profile: "default",
      client: stubClient(),
      mcpManager: new McpManager(),
    });

    const result = await delegateRemote("ping", "target");

    expect(result.success).toBe(true);
    expect(result.profile).toBe("@target");
    expect(typeof result.response).toBe("string");
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.turns).toBe(0);
    expect(result.toolsUsed).toEqual([]);
  }, 15_000);

  it("returns agent-not-found error when registry has no matching entry", async () => {
    const result = await delegateRemote("ping", "nonexistent");

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/^agent not found/);
    expect(result.profile).toBe("@nonexistent");
    expect(result.response).toBe("");
  });

  it("returns unauthorized error when the registry token is tampered", async () => {
    server = await startAgentServer({
      name: "target",
      profile: "default",
      client: stubClient(),
      mcpManager: new McpManager(),
    });

    // Tamper with the registry — replace the token with a bogus one.
    const registryFile = path.join(home, "registry.json");
    const raw = await fs.readFile(registryFile, "utf-8");
    const entries = JSON.parse(raw) as Array<{ token: string }>;
    entries[0].token = "wrong-token-abc";
    await fs.writeFile(registryFile, JSON.stringify(entries, null, 2));

    const result = await delegateRemote("ping", "target");

    expect(result.success).toBe(false);
    expect((result.error ?? "").toLowerCase()).toContain("unauthor");
    expect(result.profile).toBe("@target");
    expect(result.response).toBe("");
  }, 15_000);

  it("surfaces JSON-payload error from the remote tool handler (empty task)", async () => {
    server = await startAgentServer({
      name: "target",
      profile: "default",
      client: stubClient(),
      mcpManager: new McpManager(),
    });

    const result = await delegateRemote("", "target");

    expect(result.success).toBe(false);
    expect(result.error).toBe("empty task");
    // This is the JSON-payload path, not the MCP-protocol path — error must
    // NOT be prefixed with "remote tool error:".
    expect(result.error ?? "").not.toMatch(/^remote tool error:/);
  }, 15_000);

  it("calls log.debug with 'delegate-remote' category on successful delegation", async () => {
    server = await startAgentServer({
      name: "target",
      profile: "default",
      client: stubClient(),
      mcpManager: new McpManager(),
    });

    const debugSpy = vi.spyOn(log, "debug");

    await delegateRemote("ping", "target");

    const calledWithCategory = debugSpy.mock.calls.some(
      (call) => call[0] === "delegate-remote",
    );
    expect(calledWithCategory).toBe(true);
  }, 15_000);
});
