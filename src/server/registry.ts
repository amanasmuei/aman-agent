import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { log } from "../logger.js";

export interface AgentEntry {
  name: string;            // unique handle, used as @name
  profile: string;         // aman-agent profile this server loaded
  pid: number;             // process id for liveness check
  port: number;            // 127.0.0.1 port
  token: string;           // 32-byte hex bearer
  started_at: number;      // epoch ms
  version: string;         // package version
}

export interface ListOptions {
  prune?: boolean;         // write the pruned registry back
  isAlive?: (pid: number) => boolean;  // injectable for tests
}

function amanAgentHome(): string {
  return process.env.AMAN_AGENT_HOME || path.join(os.homedir(), ".aman-agent");
}

function registryPath(): string {
  return path.join(amanAgentHome(), "registry.json");
}

async function ensureHome(): Promise<void> {
  await fs.mkdir(amanAgentHome(), { recursive: true });
}

async function readRaw(): Promise<AgentEntry[]> {
  try {
    const buf = await fs.readFile(registryPath(), "utf-8");
    const parsed = JSON.parse(buf);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") return [];
    const message = err instanceof Error ? err.message : String(err);
    log.warn("registry", `failed to read registry: ${message}`);
    return [];
  }
}

async function writeAtomic(entries: AgentEntry[]): Promise<void> {
  await ensureHome();
  const tmp = registryPath() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
  await fs.rename(tmp, registryPath());
  // Ensure mode even if file already existed (chmod is idempotent).
  try {
    await fs.chmod(registryPath(), 0o600);
  } catch {
    // best effort
  }
}

function defaultIsAlive(pid: number): boolean {
  try {
    // Signal 0 probes existence without sending anything.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function registerAgent(entry: AgentEntry): Promise<void> {
  const current = await readRaw();
  const filtered = current.filter((e) => e.name !== entry.name);
  if (filtered.length !== current.length) {
    log.warn("registry", `replacing existing entry for name="${entry.name}"`);
  }
  filtered.push(entry);
  await writeAtomic(filtered);
}

export async function unregisterAgent(name: string): Promise<void> {
  const current = await readRaw();
  const next = current.filter((e) => e.name !== name);
  if (next.length !== current.length) {
    await writeAtomic(next);
  }
}

export async function listAgents(opts: ListOptions = {}): Promise<AgentEntry[]> {
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const raw = await readRaw();
  const alive = raw.filter((e) => isAlive(e.pid));
  if (opts.prune && alive.length !== raw.length) {
    await writeAtomic(alive);
  }
  return alive;
}

export async function findAgent(name: string): Promise<AgentEntry | null> {
  const all = await listAgents();
  return all.find((e) => e.name === name) ?? null;
}
