import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GhResult } from "./types.js";

const execFileAsync = promisify(execFile);

export interface GhOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Timeout in ms (default: 30_000) */
  timeoutMs?: number;
  /** Additional environment variables */
  env?: Record<string, string>;
}

export class GhError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "GhError";
  }
}

/**
 * Run a gh CLI command safely via execFile (no shell).
 * Returns structured GhResult with stdout, stderr, exitCode.
 * Does NOT throw on non-zero exit — returns { success: false, exitCode, stderr }.
 */
export async function gh(
  args: string[],
  options?: GhOptions,
): Promise<GhResult> {
  const ghBin = options?.env?.GH_PATH ?? process.env.GH_PATH ?? "gh";
  const timeout = options?.timeoutMs ?? 30_000;

  const execOpts: Record<string, unknown> = {
    timeout,
    ...(options?.cwd ? { cwd: options.cwd } : {}),
    ...(options?.env
      ? { env: { ...process.env, ...options.env } }
      : {}),
  };

  try {
    const { stdout, stderr } = await execFileAsync(ghBin, args, execOpts);
    return { success: true, stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    const exitCode = typeof e.code === "number" ? e.code : 1;
    return {
      success: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode,
    };
  }
}

/**
 * Run gh and parse JSON output. Throws if gh fails or output isn't valid JSON.
 */
export async function ghJson<T>(
  args: string[],
  options?: GhOptions,
): Promise<T> {
  const result = await gh(args, options);

  if (!result.success) {
    throw new GhError(
      `gh command failed: ${result.stderr}`,
      result.exitCode,
      result.stderr,
    );
  }

  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new GhError(
      `Failed to parse JSON from gh output: ${result.stdout.slice(0, 200)}`,
      0,
      result.stderr,
    );
  }
}

/**
 * Check if gh CLI is available and authenticated.
 */
export async function ghAvailable(): Promise<boolean> {
  const result = await gh(["auth", "status"]);
  return result.success;
}

/**
 * Get the current repo owner/name from gh CLI.
 */
export async function ghCurrentRepo(): Promise<{
  owner: string;
  name: string;
} | null> {
  try {
    const data = await ghJson<{ owner: { login: string }; name: string }>(
      ["repo", "view", "--json", "owner,name"],
    );
    return { owner: data.owner.login, name: data.name };
  } catch {
    return null;
  }
}
