import pc from "picocolors";
import * as p from "@clack/prompts";
import { startAgentServer, type RunningAgentServer } from "./index.js";
import { McpManager } from "../mcp/client.js";
import { pickLLMClient } from "../llm/index.js";
import { loadConfig, type AgentConfig, type HooksConfig } from "../config.js";

export interface ServeOptions {
  name: string;
  profile: string;
}

/**
 * Entry point for `aman-agent serve --name X --profile Y`.
 *
 * Process lifecycle:
 *   1. Load config + pick an LLM client (Task 0's factory honors
 *      AMAN_AGENT_FAKE_LLM=1 and short-circuits to the fake client).
 *   2. Connect aman-mcp + any custom MCP servers from config. When
 *      AMAN_AGENT_FAKE_LLM=1 we skip MCP entirely so Task 13's integration
 *      test stays hermetic (no `npx -y @aman_asmuei/aman-mcp` fetch in CI).
 *   3. Start the A2A server (Task 7's `startAgentServer`).
 *   4. Install SIGINT/SIGTERM handlers, idempotent via `shuttingDown` guard,
 *      which stop the server, disconnect MCP, then exit 0.
 *   5. Block forever on an unresolved promise so the event loop stays alive
 *      until a signal fires.
 *
 * NOTE: `running.stop()` does not drain in-flight `agent.delegate` calls —
 * mid-flight delegations are cut off at shutdown. Acceptable for MVP.
 */
export async function runServe(opts: ServeOptions): Promise<void> {
  const config: AgentConfig | null = loadConfig();
  if (!config) {
    throw new Error(
      "aman-agent is not configured. Run `aman-agent` once interactively to set up your provider before starting serve mode.",
    );
  }
  const model = config.model ?? "claude-sonnet-4-6";

  p.intro(
    pc.bold("aman-agent serve") +
      pc.dim(` — name=${opts.name} profile=${opts.profile}`),
  );

  // 1. LLM client (honors AMAN_AGENT_FAKE_LLM via the factory from Task 0)
  const client = pickLLMClient(config, model);

  // 2. MCP manager — matches the interactive baseline at src/index.ts:463–465:
  //    ONLY aman-mcp is auto-connected (NOT amem). Custom mcpServers entries
  //    are connected too, skipping the reserved names "aman" and "amem".
  //    When AMAN_AGENT_FAKE_LLM=1 we skip MCP entirely so the A2A integration
  //    test (Task 13) stays hermetic.
  const mcpManager = new McpManager();
  if (process.env.AMAN_AGENT_FAKE_LLM !== "1") {
    try {
      await mcpManager.connect("aman", "npx", ["-y", "@aman_asmuei/aman-mcp"]);
    } catch (err) {
      p.log.warning(
        `aman-mcp unavailable — continuing without tools: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (config.mcpServers) {
      for (const [name, sc] of Object.entries(config.mcpServers)) {
        if (name === "aman" || name === "amem") continue;
        try {
          await mcpManager.connect(name, sc.command, sc.args, sc.env);
        } catch {
          /* connect() logs internally — warnings only, not fatal */
        }
      }
    }
  }

  // 3. Start the A2A server (wired by Task 7)
  const running: RunningAgentServer = await startAgentServer({
    name: opts.name,
    profile: opts.profile,
    client,
    mcpManager,
    hooksConfig: config.hooks as HooksConfig | undefined,
  });

  p.log.success(`registered as @${opts.name}`);
  p.log.info(
    `port ${running.entry.port} (127.0.0.1) — token is in ~/.aman-agent/registry.json (mode 0600)`,
  );

  // 4. Signal handlers. Guard against double-fire so SIGINT+SIGTERM in quick
  //    succession doesn't call stop() twice — transport.close is not
  //    guaranteed safe to call twice and an MCP SDK close on a torn-down
  //    transport throws.
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    p.log.warning(`received ${signal}, unregistering @${opts.name}...`);
    try {
      await running.stop();
    } catch (err) {
      p.log.error(
        `stop failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await mcpManager.disconnect();
    } catch {
      /* best effort — never block exit on MCP teardown */
    }
    p.outro("goodbye");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // 5. Keep the event loop alive indefinitely — signal handlers call
  //    process.exit(), so this promise never needs to resolve.
  await new Promise<never>(() => {
    /* never resolves */
  });
}
