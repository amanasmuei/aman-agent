import pc from "picocolors";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { listAgents, findAgent } from "../server/registry.js";
import type { CommandResult } from "./shared.js";

export async function handleAgentsCommand(
  action: string | undefined,
  args: string[],
): Promise<CommandResult> {
  const sub = action ?? "list";

  if (sub === "list") {
    const all = await listAgents();
    if (all.length === 0) {
      return { handled: true, output: "No agents running." };
    }
    const rows = all.map((a) => {
      const uptime = Math.round((Date.now() - a.started_at) / 1000);
      return `  @${a.name.padEnd(12)} ${a.profile.padEnd(12)} pid=${String(a.pid).padEnd(6)} port=${a.port}  up ${uptime}s`;
    });
    return { handled: true, output: ["Running agents:", ...rows].join("\n") };
  }

  if (sub === "info") {
    const name = args[0];
    if (!name) {
      return { handled: true, output: pc.yellow("Usage: /agents info <name>") };
    }
    const entry = await findAgent(name);
    if (!entry) {
      return { handled: true, output: `No such agent: ${name}` };
    }
    const url = new URL(`http://127.0.0.1:${entry.port}/mcp`);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${entry.token}` } },
    });
    const client = new Client({ name: "aman-agent-cli", version: "0.1.0" });
    try {
      await client.connect(transport);
      const res = await client.callTool({ name: "agent.info", arguments: {} });
      const text = Array.isArray(res.content)
        ? (res.content as Array<{ type: string; text?: string }>)
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("")
        : "";
      return { handled: true, output: `@${entry.name}:\n${text}` };
    } catch (err) {
      return {
        handled: true,
        output: pc.red(
          `Error calling @${name}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    } finally {
      try {
        await client.close();
      } catch {
        /* best effort */
      }
    }
  }

  if (sub === "ping") {
    const name = args[0];
    if (!name) {
      return { handled: true, output: pc.yellow("Usage: /agents ping <name>") };
    }
    const entry = await findAgent(name);
    if (!entry) {
      return { handled: true, output: `No such agent: ${name}` };
    }
    const t0 = Date.now();
    try {
      const res = await fetch(`http://127.0.0.1:${entry.port}/health`, {
        headers: { Authorization: `Bearer ${entry.token}` },
      });
      if (!res.ok) {
        return { handled: true, output: `@${name}: HTTP ${res.status}` };
      }
      return { handled: true, output: `@${name}: ok (${Date.now() - t0}ms)` };
    } catch (err) {
      return {
        handled: true,
        output: `@${name}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    handled: true,
    output: pc.yellow("Usage: /agents [list|info <name>|ping <name>]"),
  };
}
