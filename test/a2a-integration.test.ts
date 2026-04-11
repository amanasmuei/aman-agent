// test/a2a-integration.test.ts
//
// PREREQUISITE: `npm run build` must have run before this file. The test
// spawns `node bin/aman-agent.js` and imports from `dist/`, both of which
// need the compiled output. The beforeAll below asserts this explicitly.
//
// This is the acceptance test for the A2A (agent-to-agent) MCP server mode.
// It spawns two real Node processes — one `aman-agent serve` host and one
// caller — and verifies the caller can delegate a task through the MCP
// transport and receive a response. Both processes run with
// AMAN_AGENT_FAKE_LLM=1 so no network, real API keys, or aman-mcp spawn
// is required.

import { describe, it, expect, afterEach, beforeEach, beforeAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BIN = path.resolve(__dirname, "../bin/aman-agent.js");
const DIST_INDEX = path.resolve(__dirname, "../dist/index.js");
const DIST_DELEGATE = path.resolve(__dirname, "../dist/delegate.js");

describe("A2A integration", () => {
  beforeAll(async () => {
    try {
      await fs.access(BIN);
      await fs.access(DIST_INDEX);
      await fs.access(DIST_DELEGATE);
    } catch {
      throw new Error(
        "A2A integration test requires a build first. Run 'npm run build' " +
          "before 'npx vitest run test/a2a-integration.test.ts'.",
      );
    }
  });

  let home: string;
  const children: ChildProcess[] = [];

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "aman-a2a-"));
  });

  afterEach(async () => {
    for (const c of children) {
      try {
        c.kill("SIGTERM");
      } catch {
        /* best effort */
      }
    }
    // Give processes a moment to clean up
    await new Promise((r) => setTimeout(r, 100));
    children.length = 0;
    await fs.rm(home, { recursive: true, force: true });
  });

  async function waitForRegistration(
    name: string,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const buf = await fs.readFile(
          path.join(home, "registry.json"),
          "utf-8",
        );
        const entries = JSON.parse(buf);
        if (entries.some((e: { name: string }) => e.name === name)) return;
      } catch {
        /* not there yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `timed out waiting for @${name} to register in ${home}`,
    );
  }

  it("one serve process registers and responds to /health", async () => {
    const serve = spawn(
      "node",
      [BIN, "serve", "--name", "coder", "--profile", "default"],
      {
        env: {
          ...process.env,
          AMAN_AGENT_HOME: home,
          AMAN_AGENT_FAKE_LLM: "1",
        },
        stdio: "pipe",
      },
    );
    children.push(serve);

    // Stream server output to help debug failures
    let stderr = "";
    serve.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    await waitForRegistration("coder");

    const entries = JSON.parse(
      await fs.readFile(path.join(home, "registry.json"), "utf-8"),
    );
    const entry = entries.find(
      (e: { name: string }) => e.name === "coder",
    );
    expect(entry).toBeDefined();
    expect(entry.pid).toBe(serve.pid);
    expect(entry.port).toBeGreaterThan(1024);

    const health = await fetch(`http://127.0.0.1:${entry.port}/health`, {
      headers: { Authorization: `Bearer ${entry.token}` },
      signal: AbortSignal.timeout(5000),
    });
    expect(health.status).toBe(200);
    const body = await health.json();
    expect(body).toEqual({ ok: true });

    // stderr is captured for diagnostics; fake-LLM mode may print warnings
    // which should not fail the test. Reference `stderr` so lint doesn't
    // complain about an unused binding.
    void stderr;
  }, 30_000);

  it("delegateRemote from a second process returns a response via @coder", async () => {
    const serve = spawn(
      "node",
      [BIN, "serve", "--name", "coder", "--profile", "default"],
      {
        env: {
          ...process.env,
          AMAN_AGENT_HOME: home,
          AMAN_AGENT_FAKE_LLM: "1",
        },
        stdio: "pipe",
      },
    );
    children.push(serve);
    await waitForRegistration("coder");

    // Second Node process imports delegateTask from the built dist and
    // calls it with @coder. The @-prefix routing (Task 11) goes through
    // delegateRemote, which dials the serve process via MCP and gets a
    // response.
    const callerScript = `
import { delegateTask } from ${JSON.stringify(DIST_DELEGATE)};
// Local client/mgr args are not touched on the @-path, so nulls are safe.
const r = await delegateTask("ping", "@coder", null, null);
console.log("RESULT=" + JSON.stringify(r));
// Force exit: the MCP streamable HTTP client transport keeps the event
// loop alive even after .close(), so a plain 'await' script would hang.
process.exit(0);
`;
    const caller = spawn(
      "node",
      ["--input-type=module", "-e", callerScript],
      {
        env: {
          ...process.env,
          AMAN_AGENT_HOME: home,
          AMAN_AGENT_FAKE_LLM: "1",
        },
        stdio: ["inherit", "pipe", "pipe"],
      },
    );
    children.push(caller);

    let stdout = "";
    let stderr = "";
    caller.stdout!.on("data", (c) => {
      stdout += c.toString();
    });
    caller.stderr!.on("data", (c) => {
      stderr += c.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      caller.on("exit", (code) => resolve(code ?? -1));
    });

    if (exitCode !== 0) {
      throw new Error(
        `caller process exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }

    // Extract the RESULT= line
    const resultLine = stdout
      .split("\n")
      .find((l) => l.startsWith("RESULT="));
    expect(resultLine).toBeDefined();
    const result = JSON.parse(resultLine!.slice("RESULT=".length));

    expect(result.success).toBe(true);
    expect(result.profile).toBe("@coder");
    expect(typeof result.response).toBe("string");
    expect(result.response.length).toBeGreaterThan(0);
  }, 30_000);
});
