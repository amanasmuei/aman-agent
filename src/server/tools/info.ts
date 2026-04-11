import type { Inbox } from "../inbox.js";
import pkg from "../../../package.json" with { type: "json" };

export interface InfoContext {
  name: string;
  profile: string;
  startedAt: number;
  inbox: Inbox;
}

export interface InfoResult {
  name: string;
  profile: string;
  pid: number;
  started_at: number;
  pending_inbox: number;
  version: string;
}

/**
 * Handler for the `agent.info` MCP tool. Returns the running agent's
 * identity, profile, PID, startup timestamp, inbox depth, and version.
 *
 * Pure function — has no side effects and reads no global state beyond
 * `process.pid` and the imported `package.json` version.
 */
export function infoHandler(ctx: InfoContext): InfoResult {
  return {
    name: ctx.name,
    profile: ctx.profile,
    pid: process.pid,
    started_at: ctx.startedAt,
    pending_inbox: ctx.inbox.count,
    version: pkg.version,
  };
}
