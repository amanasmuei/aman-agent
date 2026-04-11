import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createTransport, type ServerTransport } from "./transport.js";
import { registerAgent, unregisterAgent, type AgentEntry } from "./registry.js";
import { Inbox } from "./inbox.js";
import { infoHandler } from "./tools/info.js";
import { sendHandler } from "./tools/send.js";
import { delegateToolHandler, type DelegateContext } from "./tools/delegate.js";
import type { LLMClient } from "../llm/types.js";
import type { McpManager } from "../mcp/client.js";
import type { HooksConfig } from "../config.js";
import pkg from "../../package.json" with { type: "json" };

export interface StartAgentServerOptions {
  name: string;
  profile: string;
  client: LLMClient;
  mcpManager: McpManager;
  hooksConfig?: HooksConfig;
}

export interface RunningAgentServer {
  entry: AgentEntry;
  inbox: Inbox;
  stop: () => Promise<void>;
}

/**
 * Assemble an `McpServer` exposing `agent.info`, `agent.delegate`, and
 * `agent.send`, bind it to a localhost HTTP transport with a bearer token,
 * and publish the resulting port/token to the shared registry for peers to
 * discover.
 *
 * Ordering is deliberate:
 *
 * 1. Transport bound and MCP server connected first — if anything in that
 *    chain fails we throw before touching the registry, so there's no stale
 *    entry to clean up.
 * 2. `registerAgent` runs only after a successful `mcp.connect`, meaning a
 *    registry entry always points at a live, listening server.
 * 3. `stop()` unregisters BEFORE tearing down the transport, so remote
 *    callers never see a registered entry pointing at a server that has
 *    already begun shutting down.
 */
export async function startAgentServer(
  opts: StartAgentServerOptions,
): Promise<RunningAgentServer> {
  const transport: ServerTransport = await createTransport();
  const inbox = new Inbox();
  const startedAt = Date.now();

  const delegateCtx: DelegateContext = {
    profile: opts.profile,
    client: opts.client,
    mcpManager: opts.mcpManager,
    hooksConfig: opts.hooksConfig,
  };

  const mcp = new McpServer({
    name: `aman-agent:${opts.name}`,
    version: pkg.version,
  });

  mcp.registerTool(
    "agent.info",
    {
      description: "Return this agent's identity, profile, PID, and inbox depth.",
      inputSchema: {},
    },
    async () => {
      const result = infoHandler({
        name: opts.name,
        profile: opts.profile,
        startedAt,
        inbox,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  mcp.registerTool(
    "agent.delegate",
    {
      description:
        "Delegate a task to this agent. Returns the agent's final response text.",
      inputSchema: {
        task: z.string().describe("The task to run against this agent's profile"),
        context: z.string().optional().describe("Optional extra context"),
      },
    },
    async (input) => {
      const result = await delegateToolHandler(delegateCtx, input);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  mcp.registerTool(
    "agent.send",
    {
      description:
        "Deliver a one-way message into this agent's inbox. Drained at next user turn.",
      inputSchema: {
        from: z.string().optional(),
        topic: z.string().optional(),
        body: z.string(),
      },
    },
    async (input) => {
      const result = sendHandler(inbox, input);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  try {
    await mcp.connect(transport.mcpTransport);
  } catch (err) {
    // Connect failed — tear down the transport we already bound so we don't
    // leak a listening port, then rethrow.
    await transport.close();
    throw err;
  }

  const entry: AgentEntry = {
    name: opts.name,
    profile: opts.profile,
    pid: process.pid,
    port: transport.port,
    token: transport.token,
    started_at: startedAt,
    version: pkg.version,
  };
  await registerAgent(entry);

  return {
    entry,
    inbox,
    stop: async () => {
      try {
        await unregisterAgent(opts.name);
      } catch {
        /* best effort — don't let a registry hiccup block teardown */
      }
      try {
        await mcp.close();
      } catch {
        /* best effort — don't let a flaky SDK close leak the transport */
      }
      await transport.close();
    },
  };
}
