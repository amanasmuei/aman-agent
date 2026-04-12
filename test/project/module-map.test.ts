import { describe, it, expect } from "vitest";
import {
  buildModuleMap,
  hasOverlap,
  assignModules,
  type DirectoryEntry,
  type ModuleEntry,
  type ModuleMap,
} from "../../src/project/module-map.js";

function entry(path: string, isDirectory = false): DirectoryEntry {
  return { path, isDirectory };
}

describe("buildModuleMap", () => {
  it("groups src/ subdirectories into modules", () => {
    const entries: DirectoryEntry[] = [
      entry("src/auth", true),
      entry("src/auth/login.ts"),
      entry("src/auth/session.ts"),
      entry("src/api", true),
      entry("src/api/routes.ts"),
      entry("src/api/handlers.ts"),
    ];
    const map = buildModuleMap(entries);
    const auth = map.modules.find((m) => m.name === "auth");
    const api = map.modules.find((m) => m.name === "api");
    expect(auth).toBeDefined();
    expect(auth!.paths).toContain("src/auth");
    expect(auth!.paths).toContain("src/auth/login.ts");
    expect(auth!.paths).toContain("src/auth/session.ts");
    expect(api).toBeDefined();
    expect(api!.paths).toContain("src/api");
    expect(api!.paths).toContain("src/api/routes.ts");
  });

  it("puts root files into 'core' module", () => {
    const entries: DirectoryEntry[] = [
      entry("src/index.ts"),
      entry("src/main.ts"),
      entry("src/auth", true),
      entry("src/auth/login.ts"),
    ];
    const map = buildModuleMap(entries);
    const core = map.modules.find((m) => m.name === "core");
    expect(core).toBeDefined();
    expect(core!.paths).toContain("src/index.ts");
    expect(core!.paths).toContain("src/main.ts");
    // auth dir should NOT be in core
    expect(core!.paths).not.toContain("src/auth");
  });

  it("identifies test directories as 'tests' module", () => {
    const entries: DirectoryEntry[] = [
      entry("test", true),
      entry("test/auth.test.ts"),
      entry("__tests__", true),
      entry("__tests__/api.test.ts"),
    ];
    const map = buildModuleMap(entries);
    const tests = map.modules.find((m) => m.name === "tests");
    expect(tests).toBeDefined();
    expect(tests!.paths).toContain("test");
    expect(tests!.paths).toContain("test/auth.test.ts");
    expect(tests!.paths).toContain("__tests__");
    expect(tests!.paths).toContain("__tests__/api.test.ts");
  });

  it("handles empty input", () => {
    const map = buildModuleMap([]);
    expect(map.modules).toEqual([]);
    expect(map.unmapped).toEqual([]);
  });

  it("puts non-src non-test root files into unmapped", () => {
    const entries: DirectoryEntry[] = [
      entry("package.json"),
      entry("tsconfig.json"),
      entry("README.md"),
    ];
    const map = buildModuleMap(entries);
    expect(map.unmapped).toContain("package.json");
    expect(map.unmapped).toContain("tsconfig.json");
    expect(map.unmapped).toContain("README.md");
  });

  it("groups docs/ into 'docs' module", () => {
    const entries: DirectoryEntry[] = [
      entry("docs", true),
      entry("docs/guide.md"),
    ];
    const map = buildModuleMap(entries);
    const docs = map.modules.find((m) => m.name === "docs");
    expect(docs).toBeDefined();
    expect(docs!.paths).toContain("docs");
    expect(docs!.paths).toContain("docs/guide.md");
  });
});

describe("hasOverlap", () => {
  it("returns false for non-overlapping modules", () => {
    const a: ModuleEntry = {
      name: "auth",
      paths: ["src/auth", "src/auth/login.ts"],
      description: "auth module",
      dependencies: [],
    };
    const b: ModuleEntry = {
      name: "api",
      paths: ["src/api", "src/api/routes.ts"],
      description: "api module",
      dependencies: [],
    };
    expect(hasOverlap(a, b)).toBe(false);
  });

  it("returns true for overlapping paths", () => {
    const a: ModuleEntry = {
      name: "auth",
      paths: ["src/auth", "src/auth/login.ts", "src/shared/utils.ts"],
      description: "auth module",
      dependencies: [],
    };
    const b: ModuleEntry = {
      name: "shared",
      paths: ["src/shared", "src/shared/utils.ts"],
      description: "shared module",
      dependencies: [],
    };
    expect(hasOverlap(a, b)).toBe(true);
  });
});

describe("assignModules", () => {
  function makeMap(moduleNames: string[]): ModuleMap {
    return {
      projectPath: "/test",
      modules: moduleNames.map((name) => ({
        name,
        paths: [`src/${name}`],
        description: `${name} module`,
        dependencies: [],
      })),
      unmapped: [],
    };
  }

  it("distributes modules across agents via round-robin", () => {
    const map = makeMap(["auth", "api", "db", "frontend"]);
    const result = assignModules(map, 2);
    expect(result.size).toBe(2);
    // Round-robin: agent 0 gets modules 0,2; agent 1 gets modules 1,3
    const agent0 = result.get(0)!;
    const agent1 = result.get(1)!;
    expect(agent0.map((m) => m.name)).toEqual(["auth", "db"]);
    expect(agent1.map((m) => m.name)).toEqual(["api", "frontend"]);
  });

  it("handles more agents than modules", () => {
    const map = makeMap(["auth", "api"]);
    const result = assignModules(map, 5);
    // Only 2 modules, so agents 0 and 1 get one each, rest get empty
    expect(result.get(0)!.length).toBe(1);
    expect(result.get(1)!.length).toBe(1);
    expect(result.get(2)!.length).toBe(0);
    expect(result.get(3)!.length).toBe(0);
    expect(result.get(4)!.length).toBe(0);
  });

  it("handles single agent", () => {
    const map = makeMap(["auth", "api", "db"]);
    const result = assignModules(map, 1);
    expect(result.get(0)!.length).toBe(3);
  });
});
