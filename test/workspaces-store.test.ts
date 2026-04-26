import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadStore, saveStore, storePath } from "../src/workspaces/store.js";
import { EMPTY_STORE, type WorkspaceStore } from "../src/workspaces/types.js";

let tmp: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "aman-agent-ws-"));
  originalEnv = process.env.AMAN_AGENT_HOME;
  process.env.AMAN_AGENT_HOME = tmp;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.AMAN_AGENT_HOME;
  else process.env.AMAN_AGENT_HOME = originalEnv;
  fsSync.rmSync(tmp, { recursive: true, force: true });
});

describe("workspaces/store", () => {
  it("loadStore returns EMPTY_STORE when file does not exist", async () => {
    const store = await loadStore();
    expect(store).toEqual(EMPTY_STORE);
  });

  it("loadStore returns EMPTY_STORE when file is corrupt JSON", async () => {
    await fs.writeFile(storePath(), "not json {{{", "utf-8");
    const store = await loadStore();
    expect(store).toEqual(EMPTY_STORE);
  });

  it("loadStore returns EMPTY_STORE when version is unknown", async () => {
    await fs.writeFile(
      storePath(),
      JSON.stringify({ version: 99, workspaces: [] }),
      "utf-8",
    );
    const store = await loadStore();
    expect(store).toEqual(EMPTY_STORE);
  });

  it("saveStore + loadStore round-trip preserves all fields", async () => {
    const original: WorkspaceStore = {
      version: 1,
      workspaces: [
        {
          path: "/Users/test/repo-a",
          name: "repo-a",
          firstSeen: "2026-04-26T08:00:00.000Z",
          lastSeen: "2026-04-26T14:00:00.000Z",
          archived: false,
          notes: "first repo",
        },
        {
          path: "/Users/test/repo-b",
          name: "repo-b",
          firstSeen: "2026-04-25T08:00:00.000Z",
          lastSeen: "2026-04-25T08:00:00.000Z",
          archived: true,
        },
      ],
    };
    await saveStore(original);
    const loaded = await loadStore();
    expect(loaded).toEqual(original);
  });

  it("saveStore is atomic — writes via .tmp then renames (no partial file)", async () => {
    const dir = process.env.AMAN_AGENT_HOME!;
    await saveStore({ version: 1, workspaces: [] });
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("workspaces"));
    // Only the final file remains; .tmp was renamed (not left behind)
    expect(files).toContain("workspaces.json");
    expect(files).not.toContain("workspaces.json.tmp");
  });
});
