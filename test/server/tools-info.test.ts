import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Inbox } from "../../src/server/inbox.js";
import { infoHandler, type InfoContext } from "../../src/server/tools/info.js";

function makeCtx(overrides: Partial<InfoContext> = {}): InfoContext {
  return {
    name: "test-agent",
    profile: "default",
    startedAt: 1_700_000_000_000,
    inbox: new Inbox(),
    ...overrides,
  };
}

describe("infoHandler", () => {
  it("empty-inbox: returns full identity info with pending_inbox=0", async () => {
    const ctx = makeCtx();
    const result = infoHandler(ctx);

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkgRaw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw) as { version: string };

    expect(result).toEqual({
      name: "test-agent",
      profile: "default",
      pid: process.pid,
      started_at: 1_700_000_000_000,
      pending_inbox: 0,
      version: pkg.version,
    });
  });

  it("pending-after-enqueue: reflects inbox depth after 2 messages", () => {
    const inbox = new Inbox();
    inbox.enqueue({ from: "user", body: "first" });
    inbox.enqueue({ from: "other-agent", body: "second" });
    const ctx = makeCtx({ name: "busy-agent", profile: "dev", inbox });

    const result = infoHandler(ctx);

    expect(result.pending_inbox).toBe(2);
    expect(result.name).toBe("busy-agent");
    expect(result.profile).toBe("dev");
    expect(result.pid).toBe(process.pid);
    expect(result.started_at).toBe(1_700_000_000_000);
    expect(typeof result.version).toBe("string");
  });

  it("version-matches-package-json: result.version equals package.json version on disk", async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkgRaw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw) as { version: string };

    const result = infoHandler(makeCtx());

    expect(result.version).toBe(pkg.version);
  });
});
