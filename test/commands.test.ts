import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpHome = path.join(os.tmpdir(), `aman-agent-test-cmds-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, homedir: () => tmpHome } };
});

const { handleCommand } = await import("../src/commands.js");

describe("handleCommand", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpHome, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // --- Quit commands ---

  describe("/quit, /exit, /q", () => {
    it("/quit sets quit flag", () => {
      const result = handleCommand("/quit");
      expect(result.handled).toBe(true);
      expect(result.quit).toBe(true);
    });

    it("/exit sets quit flag", () => {
      const result = handleCommand("/exit");
      expect(result.handled).toBe(true);
      expect(result.quit).toBe(true);
    });

    it("/q sets quit flag", () => {
      const result = handleCommand("/q");
      expect(result.handled).toBe(true);
      expect(result.quit).toBe(true);
    });
  });

  // --- Help ---

  describe("/help", () => {
    it("returns help output listing commands", () => {
      const result = handleCommand("/help");
      expect(result.handled).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain("/help");
      expect(result.output).toContain("/quit");
      expect(result.output).toContain("/identity");
      expect(result.output).toContain("/tools");
      expect(result.output).toContain("/workflows");
      expect(result.output).toContain("/rules");
      expect(result.output).toContain("/skills");
      expect(result.output).toContain("/model");
      expect(result.output).toContain("/clear");
    });
  });

  // --- Clear ---

  describe("/clear", () => {
    it("sets clearHistory flag", () => {
      const result = handleCommand("/clear");
      expect(result.handled).toBe(true);
      expect(result.clearHistory).toBe(true);
      expect(result.output).toContain("cleared");
    });
  });

  // --- Model ---

  describe("/model", () => {
    it("shows provided model name", () => {
      const result = handleCommand("/model", "claude-sonnet-4-20250514");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("claude-sonnet-4-20250514");
    });

    it("shows unknown when no model provided", () => {
      const result = handleCommand("/model");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("unknown");
    });
  });

  // --- Ecosystem file commands ---

  describe("/identity", () => {
    it("shows core.md content when file exists", () => {
      const dir = path.join(tmpHome, ".acore");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "core.md"), "# My Identity", "utf-8");

      const result = handleCommand("/identity");
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Identity");
    });

    it("shows not-found message when file is missing", () => {
      const result = handleCommand("/identity");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
      expect(result.output).toContain("identity");
    });
  });

  describe("/tools", () => {
    it("shows kit.md content when file exists", () => {
      const dir = path.join(tmpHome, ".akit");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "kit.md"), "# My Tools", "utf-8");

      const result = handleCommand("/tools");
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Tools");
    });

    it("shows not-found message when file is missing", () => {
      const result = handleCommand("/tools");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
      expect(result.output).toContain("tools");
    });
  });

  describe("/workflows", () => {
    it("shows flow.md content when file exists", () => {
      const dir = path.join(tmpHome, ".aflow");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "flow.md"), "# My Workflows", "utf-8");

      const result = handleCommand("/workflows");
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Workflows");
    });

    it("shows not-found message when file is missing", () => {
      const result = handleCommand("/workflows");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
      expect(result.output).toContain("workflows");
    });
  });

  describe("/rules", () => {
    it("shows rules.md content when file exists", () => {
      const dir = path.join(tmpHome, ".arules");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "rules.md"), "# My Rules", "utf-8");

      const result = handleCommand("/rules");
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Rules");
    });

    it("shows not-found message when file is missing", () => {
      const result = handleCommand("/rules");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
      expect(result.output).toContain("guardrails");
    });
  });

  describe("/skills", () => {
    it("shows skills.md content when file exists", () => {
      const dir = path.join(tmpHome, ".askill");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "skills.md"), "# My Skills", "utf-8");

      const result = handleCommand("/skills");
      expect(result.handled).toBe(true);
      expect(result.output).toBe("# My Skills");
    });

    it("shows not-found message when file is missing", () => {
      const result = handleCommand("/skills");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("No");
      expect(result.output).toContain("skills");
    });
  });

  // --- Unknown commands ---

  describe("unknown commands", () => {
    it("handles unknown slash command", () => {
      const result = handleCommand("/foobar");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("Unknown command");
      expect(result.output).toContain("/foobar");
    });
  });

  // --- Non-commands ---

  describe("non-commands (regular input)", () => {
    it("returns handled: false for regular text", () => {
      const result = handleCommand("hello world");
      expect(result.handled).toBe(false);
      expect(result.output).toBeUndefined();
    });

    it("returns handled: false for empty string", () => {
      const result = handleCommand("");
      expect(result.handled).toBe(false);
    });
  });

  // --- Case insensitivity ---

  describe("case insensitivity", () => {
    it("handles uppercase /HELP", () => {
      const result = handleCommand("/HELP");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("/help");
    });

    it("handles mixed case /QuIt", () => {
      const result = handleCommand("/QuIt");
      expect(result.handled).toBe(true);
      expect(result.quit).toBe(true);
    });
  });

  // --- Whitespace handling ---

  describe("whitespace handling", () => {
    it("trims leading/trailing whitespace", () => {
      const result = handleCommand("  /help  ");
      expect(result.handled).toBe(true);
      expect(result.output).toContain("/help");
    });
  });
});
