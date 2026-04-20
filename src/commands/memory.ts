import pc from "picocolors";
import {
  memoryContext,
  memoryRecall,
  memoryMultiRecall,
  memoryForget,
  memoryStats,
  memoryExport,
  memorySince,
  memorySearch,
  memoryDoctor,
  memoryRepair,
  memoryConfig,
  memoryReflect,
  memoryConsolidate,
  memoryTier,
  memoryDetail,
  memoryRelate,
  memoryExpire,
  memoryVersions,
  memorySync,
  getMirrorEngine,
  syncFromMirrorDir,
} from "../memory.js";
import { expandHome } from "../config.js";
import {
  buildNestedUpdate,
  type CommandContext,
  type CommandResult,
} from "./shared.js";

function parseFlagValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === flag) {
      return args[i + 1];
    }
    if (a.startsWith(`${flag}=`)) {
      return a.slice(flag.length + 1);
    }
  }
  return undefined;
}

function relativeTimeFromNow(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

export async function handleMemoryCommand(
  action: string | undefined,
  args: string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  if (!action) {
    try {
      const result = await memoryContext("recent context");
      if (result.memoriesUsed === 0) {
        return { handled: true, output: pc.dim("No memories yet. Start chatting and I'll remember what matters.") };
      }
      return { handled: true, output: result.text };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action && !["search", "clear", "timeline", "stats", "export", "since", "fts", "help", "doctor", "repair", "config", "reflect", "consolidate", "tier", "detail", "relate", "expire", "versions", "sync", "mirror"].includes(action)) {
    try {
      const topic = [action, ...args].join(" ");
      const result = await memoryContext(topic);
      if (result.memoriesUsed === 0) {
        return { handled: true, output: pc.dim(`No memories found for: "${topic}".`) };
      }
      return { handled: true, output: result.text };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "search") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /memory search <query...>") };
    }
    const query = args.join(" ");
    try {
      const result = await memoryMultiRecall(query, { limit: 10 });
      if (result.total === 0) {
        return { handled: true, output: pc.dim("No memories found.") };
      }
      const header = `Search results for "${query}" (${result.total}):`;
      const lines: string[] = [pc.bold(header), ""];
      for (const m of result.memories) {
        const tags = m.tags?.length > 0
          ? ` ${pc.dim(m.tags.map((t: string) => `#${t}`).join(" "))}`
          : "";
        lines.push(`  [${m.type}] ${m.content}${tags}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "clear") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /memory clear <query>  — delete memories matching a search query\n       /memory clear --type <type>  — delete all memories of a type (correction|decision|pattern|preference|topology|fact)") };
    }
    try {
      if (args[0] === "--type" && args[1]) {
        const result = await memoryForget({ type: args[1] });
        return { handled: true, output: result.deleted > 0 ? pc.green(result.message) : pc.dim(result.message) };
      }
      const result = await memoryForget({ query: args.join(" ") });
      return { handled: true, output: result.deleted > 0 ? pc.green(result.message) : pc.dim(result.message) };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "timeline") {
    try {
      const result = await memoryRecall("*", { limit: 500, compact: false });
      if (result.total === 0) {
        return { handled: true, output: pc.dim("No memories yet. Start chatting and I'll remember what matters.") };
      }
      const memories = result.memories;
      if (memories.length > 0) {
        const byDate = new Map<string, number>();
        for (const mem of memories) {
          const createdAt = (mem as { created_at?: number }).created_at;
          const date = createdAt
            ? new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "Unknown";
          byDate.set(date, (byDate.get(date) || 0) + 1);
        }
        const maxCount = Math.max(...byDate.values());
        const barWidth = 10;
        const lines: string[] = [pc.bold("Memory Timeline:"), ""];
        for (const [date, count] of byDate) {
          const filled = Math.round((count / maxCount) * barWidth);
          const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
          lines.push(`  ${date.padEnd(8)} ${bar}  ${count} memories`);
        }
        const tags = new Map<string, number>();
        for (const mem of memories) {
          const memTags = (mem as { tags?: string[] }).tags;
          if (Array.isArray(memTags)) {
            for (const tag of memTags) {
              tags.set(tag, (tags.get(tag) || 0) + 1);
            }
          }
        }
        lines.push("");
        lines.push(`  Total: ${result.total} memories`);
        if (tags.size > 0) {
          const topTags = [...tags.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([tag, count]) => `#${tag} (${count})`)
            .join(", ");
          lines.push(`  Top tags: ${topTags}`);
        }
        return { handled: true, output: lines.join("\n") };
      }
      return { handled: true, output: `Total memories: ${result.total} entries.` };
    } catch {
      return { handled: true, output: pc.red("Failed to retrieve memory timeline.") };
    }
  }
  if (action === "stats") {
    try {
      const stats = memoryStats();
      const lines: string[] = [pc.bold("Memory Statistics:"), ""];
      lines.push(`  Total memories: ${pc.bold(String(stats.total))}`);
      if (Object.keys(stats.byType).length > 0) {
        lines.push("");
        lines.push(`  ${pc.dim("By type:")}`);
        for (const [type, count] of Object.entries(stats.byType)) {
          lines.push(`    ${type.padEnd(16)} ${count}`);
        }
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "export") {
    try {
      // `--to <dir>` / `--to=<dir>` → one-shot snapshot via MirrorEngine.
      // Leaves legacy stdout-dump behaviour unchanged so existing callers of
      // `/memory export [json]` keep working.
      const toDir = parseFlagValue(args, "--to");
      if (toDir !== undefined) {
        const engine = getMirrorEngine();
        if (!engine) {
          return { handled: true, output: pc.yellow("Mirror is disabled — enable via config.mirror.enabled in config.json.") };
        }
        const resolved = expandHome(toDir);
        const res = await engine.exportSnapshot(resolved);
        const lines = [
          `Wrote ${res.written} files to ${resolved} (${res.skipped} skipped, ${res.errors.length} errors).`,
        ];
        if (res.errors.length > 0) {
          lines.push("");
          for (const e of res.errors.slice(0, 5)) lines.push(`  - ${e}`);
          if (res.errors.length > 5) lines.push(`  ...and ${res.errors.length - 5} more`);
        }
        return { handled: true, output: lines.join("\n") };
      }
      const format = args[0] === "json" ? "json" : "markdown";
      const memories = memoryExport();
      if (memories.length === 0) {
        return { handled: true, output: pc.dim("No memories to export.") };
      }
      if (format === "json") {
        const jsonOut = memories.map(m => ({ id: m.id, type: m.type, content: m.content, tags: m.tags, confidence: m.confidence, createdAt: m.createdAt, tier: m.tier }));
        return { handled: true, output: JSON.stringify(jsonOut, null, 2) };
      }
      const lines: string[] = [`# Memory Export (${memories.length} memories)`, ""];
      for (const m of memories) {
        const date = new Date(m.createdAt).toLocaleDateString();
        const tags = m.tags.length > 0 ? ` [${m.tags.map(t => `#${t}`).join(", ")}]` : "";
        lines.push(`- **[${m.type}]** ${m.content}${tags} ${pc.dim(`(${date}, ${Math.round(m.confidence * 100)}%)`)}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "since") {
    try {
      let hours = 24;
      if (args[0]) {
        const match = args[0].match(/^(\d+)(h|d|w)$/);
        if (match) {
          const value = parseInt(match[1], 10);
          const unit = match[2];
          if (unit === "h") hours = value;
          else if (unit === "d") hours = value * 24;
          else if (unit === "w") hours = value * 24 * 7;
        } else {
          return { handled: true, output: pc.yellow("Usage: /memory since <Nh|Nd|Nw>  (e.g., 24h, 7d, 1w)") };
        }
      }
      const memories = memorySince(hours);
      if (memories.length === 0) {
        return { handled: true, output: pc.dim(`No memories in the last ${args[0] || "24h"}.`) };
      }
      const lines: string[] = [pc.bold(`Memories since ${args[0] || "24h"} (${memories.length}):`), ""];
      for (const m of memories) {
        const age = Math.round((Date.now() - m.createdAt) / 3600000);
        const ageStr = age < 1 ? "<1h ago" : `${age}h ago`;
        lines.push(`  ${pc.dim(ageStr.padEnd(10))} [${m.type}] ${m.content}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "fts") {
    if (args.length < 1) {
      return { handled: true, output: pc.yellow("Usage: /memory fts <query...>  — full-text search") };
    }
    try {
      const query = args.join(" ");
      const results = memorySearch(query, 20);
      if (results.length === 0) {
        return { handled: true, output: pc.dim(`No results for full-text search: "${query}".`) };
      }
      const lines: string[] = [pc.bold(`FTS results for "${query}" (${results.length}):`), ""];
      for (const m of results) {
        const tags = m.tags.length > 0 ? ` ${pc.dim(m.tags.map(t => `#${t}`).join(" "))}` : "";
        lines.push(`  [${m.type}] ${m.content}${tags}`);
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "help") {
    return { handled: true, output: [
      pc.bold("Memory commands:"),
      `  ${pc.cyan("/memory")}                    View recent context`,
      `  ${pc.cyan("/memory")} <topic>             Context for a topic`,
      `  ${pc.cyan("/memory search")} <query>      Search memories (semantic)`,
      `  ${pc.cyan("/memory fts")} <query>          Full-text search (FTS5)`,
      `  ${pc.cyan("/memory since")} <Nh|Nd|Nw>    Memories from time window`,
      `  ${pc.cyan("/memory stats")}               Show memory statistics`,
      `  ${pc.cyan("/memory export")} [json]        Export all memories`,
      `  ${pc.cyan("/memory export --to")} <dir>    Snapshot mirror-format files to <dir>`,
      `  ${pc.cyan("/memory timeline")}            View memory timeline`,
      `  ${pc.cyan("/memory clear")} <query>        Delete matching memories`,
      `  ${pc.cyan("/memory clear --type")} <type>  Delete all of a type`,
      `  ${pc.cyan("/memory doctor")}              Run memory diagnostics`,
      `  ${pc.cyan("/memory repair")}              Dry-run repair (safe)`,
      `  ${pc.cyan("/memory config")} [key=value]  View or update config (e.g. consolidation.maxStaleDays=60)`,
      `  ${pc.cyan("/memory mirror status")}        Show mirror dir, file count, health`,
      `  ${pc.cyan("/memory mirror rebuild")}       Rebuild the mirror from the DB`,
      `  ${pc.cyan("/memory sync --from")} <dir>    Import edits from a mirror-format dir`,
    ].join("\n") };
  }
  if (action === "doctor") {
    try {
      const diag = await memoryDoctor();
      const statusIcon = diag.status === "healthy" ? "✅" : "⚠️";
      const lines: string[] = [
        `**Memory Diagnostics**`,
        `Status: ${statusIcon} ${diag.status}`,
      ];
      if (diag.issues?.length) {
        lines.push("", "**Issues:**");
        for (const issue of diag.issues) {
          lines.push(`- ${typeof issue === "string" ? issue : (issue as { message?: string }).message ?? String(issue)}`);
        }
        lines.push("", "_Run `/memory repair` (dry-run) or `/memory repair --apply` to fix._");
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory doctor error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "repair") {
    try {
      const dryRun = !args.includes("--apply");
      const result = await memoryRepair({ dryRun });
      const prefix = dryRun ? "[DRY RUN] " : "";
      const lines: string[] = [`**${prefix}Memory Repair**`];
      if (result.actions?.length) {
        lines.push("", "**Actions:**");
        for (const act of result.actions) {
          lines.push(`- ${act}`);
        }
      } else {
        lines.push("No actions needed.");
      }
      if (dryRun) {
        lines.push("", "_Run `/memory repair --apply` to execute._");
      }
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory repair error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "config") {
    try {
      const kvArg = args.find((a: string) => a.includes("=") && !a.startsWith("-"));
      if (kvArg) {
        const eqIdx = kvArg.indexOf("=");
        const key = kvArg.slice(0, eqIdx);
        const rawVal = kvArg.slice(eqIdx + 1);
        if (!rawVal) {
          return { handled: true, output: pc.yellow(`Usage: /memory config <key>=<value>`) };
        }
        const val = isNaN(Number(rawVal)) ? rawVal : Number(rawVal);
        const update = buildNestedUpdate(key, val);
        await memoryConfig(update);
        return { handled: true, output: `✅ Set \`${key}\` → \`${val}\`` };
      }
      const config = await memoryConfig();
      const lines = ["**Memory Config**", "```"];
      for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
        if (typeof v === "object" && v !== null) {
          for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
            lines.push(`${k}.${sk}: ${sv}`);
          }
        } else {
          lines.push(`${k}: ${v}`);
        }
      }
      lines.push("```", "", "_Use `/memory config key=value` to change a setting._");
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Memory config error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "reflect") {
    try {
      const report = await memoryReflect();
      const lines = [
        pc.bold("Reflection complete"),
        `Clusters: ${report.clusters.length}`,
        `Contradictions: ${report.contradictions.length}`,
        `Synthesis candidates: ${report.synthesisCandidates.length}`,
        `Knowledge gaps: ${report.knowledgeGaps.length}`,
        `Health score: ${(report.stats.healthScore * 100).toFixed(0)}%`,
        `Duration: ${report.durationMs}ms`,
      ];
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Reflect error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "consolidate") {
    const apply = args.includes("--apply");
    try {
      const report = memoryConsolidate(!apply);
      const lines = [
        apply ? pc.bold("Consolidation applied") : pc.bold("Consolidation dry-run"),
        `Merged: ${report.merged}`,
        `Pruned: ${report.pruned}`,
        `Promoted: ${report.promoted}`,
        `Decayed: ${report.decayed}`,
        `Health score: ${(report.healthScore * 100).toFixed(0)}%`,
        `Before: ${report.before.total} → After: ${report.after.total}`,
      ];
      if (!apply) lines.push(pc.dim("Run with --apply to execute."));
      return { handled: true, output: lines.join("\n") };
    } catch (err) {
      return { handled: true, output: pc.red(`Consolidate error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "tier") {
    const id = args[0];
    const tier = args[1];
    if (!id || !tier) {
      return { handled: true, output: pc.yellow("Usage: /memory tier <id> <core|working|archival>") };
    }
    const tierResult = memoryTier(id, tier);
    if (!tierResult.ok) {
      return { handled: true, output: pc.red(`Tier error: ${tierResult.error}`) };
    }
    return { handled: true, output: `✅ Memory ${tierResult.id} moved to tier: ${tierResult.tier}` };
  }
  if (action === "detail") {
    const id = args[0];
    if (!id) {
      return { handled: true, output: pc.yellow("Usage: /memory detail <id>") };
    }
    const memory = memoryDetail(id);
    if (!memory) {
      return { handled: true, output: pc.dim(`Memory not found: ${id}`) };
    }
    const lines = [
      pc.bold(`Memory: ${memory.id}`),
      `Content: ${memory.content}`,
      `Type: ${memory.type}`,
      `Confidence: ${memory.confidence}`,
      `Tier: ${(memory as any).tier ?? "working"}`,
      `Access count: ${memory.accessCount}`,
      `Created: ${new Date(memory.createdAt).toISOString()}`,
      memory.tags?.length ? `Tags: ${memory.tags.join(", ")}` : "",
    ].filter(Boolean);
    return { handled: true, output: lines.join("\n") };
  }
  if (action === "relate") {
    const [fromId, toId, relType, strengthStr] = args;
    if (!fromId || !toId || !relType) {
      return { handled: true, output: pc.yellow("Usage: /memory relate <fromId> <toId> <type> [strength]") };
    }
    const strength = strengthStr !== undefined ? parseFloat(strengthStr) : undefined;
    const relResult = memoryRelate(fromId, toId, relType, strength);
    if (!relResult.ok) {
      return { handled: true, output: pc.red(`Relate error: ${relResult.error}`) };
    }
    return { handled: true, output: `✅ Relation created: ${fromId} --[${relType}]--> ${toId} (id: ${relResult.relationId})` };
  }
  if (action === "expire") {
    const id = args[0];
    if (!id) {
      return { handled: true, output: pc.yellow("Usage: /memory expire <id> [reason]") };
    }
    const reason = args.slice(1).join(" ") || undefined;
    const expireResult = memoryExpire(id, reason);
    if (!expireResult.ok) {
      return { handled: true, output: pc.red(`Expire error: ${expireResult.error}`) };
    }
    return { handled: true, output: `✅ Memory ${expireResult.id} expired${reason ? `: ${reason}` : ""}` };
  }
  if (action === "versions") {
    const id = args[0];
    if (!id) {
      return { handled: true, output: pc.yellow("Usage: /memory versions <id>") };
    }
    const versions = memoryVersions(id);
    if (!versions.length) {
      return { handled: true, output: pc.dim(`No version history for: ${id}`) };
    }
    const lines = [pc.bold(`Version history for ${id}:`)];
    for (const v of versions) {
      lines.push(`  [${new Date(v.editedAt).toISOString()}] ${v.content.slice(0, 80)}${v.content.length > 80 ? "\u2026" : ""}`);
    }
    return { handled: true, output: lines.join("\n") };
  }
  if (action === "mirror") {
    const sub = args[0];
    try {
      if (sub === "status") {
        const engine = getMirrorEngine();
        if (!engine) return { handled: true, output: pc.yellow("Mirror is disabled — enable via config.mirror.enabled in config.json.") };
        const s = engine.status();
        const last = s.lastWriteAt
          ? `${new Date(s.lastWriteAt).toISOString()} (${relativeTimeFromNow(s.lastWriteAt)})`
          : "never";
        const lines = [
          pc.bold("Mirror:"),
          `  Dir:          ${s.dir}`,
          `  File count:   ${s.fileCount}`,
          `  Last write:   ${last}`,
          `  Health:       ${s.healthy ? "healthy" : "drifted"}`,
        ];
        return { handled: true, output: lines.join("\n") };
      }
      if (sub === "rebuild") {
        const engine = getMirrorEngine();
        if (!engine) return { handled: true, output: pc.yellow("Mirror is disabled — enable via config.mirror.enabled in config.json.") };
        const res = await engine.fullMirror();
        return {
          handled: true,
          output: `Rebuilt mirror: ${res.written} files written, ${res.skipped} skipped, ${res.errors.length} errors.`,
        };
      }
      return { handled: true, output: pc.yellow("Unknown mirror subcommand; try 'status' or 'rebuild'.") };
    } catch (err) {
      return { handled: true, output: pc.red(`Mirror error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  if (action === "sync") {
    // `--from <dir>` / `--from=<dir>` → import mirror-format files into the DB.
    // This is the recovery path for the multi-device sync loop: a machine
    // that lost its DB but kept the markdown mirror can reconstruct state.
    const fromDir = parseFlagValue(args, "--from");
    if (fromDir !== undefined) {
      try {
        const resolved = expandHome(fromDir);
        const res = await syncFromMirrorDir(resolved);
        return {
          handled: true,
          output: `Synced ${res.imported} memories from ${resolved} (${res.skipped} skipped, ${res.updated} updated).`,
        };
      } catch (err) {
        return { handled: true, output: pc.red(`Sync error: ${err instanceof Error ? err.message : String(err)}`) };
      }
    }
    const syncAction = args[0] as "import-claude" | "export-team" | "import-team" | "sync-copilot" | undefined;
    if (!syncAction) {
      return { handled: true, output: pc.yellow("Usage: /memory sync <import-claude|export-team|import-team|sync-copilot>") };
    }
    try {
      const opts: Record<string, string | boolean | undefined> = {};
      for (const arg of args.slice(1)) {
        if (arg.startsWith("--")) {
          const [k, v] = arg.slice(2).split("=");
          opts[k] = v ?? true;
        }
      }
      const result = await memorySync(syncAction, opts as any);
      return { handled: true, output: `✅ Sync [${syncAction}] complete:\n${JSON.stringify(result, null, 2)}` };
    } catch (err) {
      return { handled: true, output: pc.red(`Sync error: ${err instanceof Error ? err.message : String(err)}`) };
    }
  }
  return { handled: true, output: pc.yellow(`Unknown action: /memory ${action}. Try /memory --help`) };
}
