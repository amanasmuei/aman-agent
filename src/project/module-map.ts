/**
 * Module Boundary Mapper — maps file/directory boundaries for parallel agent isolation.
 *
 * Analyzes a project's directory structure and produces a module map so that
 * multiple agents can work on non-overlapping file boundaries.
 */

export interface DirectoryEntry {
  path: string; // relative path from project root
  isDirectory: boolean;
}

export interface ModuleEntry {
  name: string; // module name (e.g., "auth", "api", "tests")
  paths: string[]; // file/dir paths belonging to this module
  description: string; // what this module does
  dependencies: string[]; // names of other modules this depends on
}

export interface ModuleMap {
  projectPath: string;
  modules: ModuleEntry[];
  unmapped: string[]; // files not assigned to any module
}

/** Well-known top-level directories that map to named modules. */
const KNOWN_MODULES: Record<string, { name: string; description: string }> = {
  test: { name: "tests", description: "Test files and test utilities" },
  tests: { name: "tests", description: "Test files and test utilities" },
  __tests__: { name: "tests", description: "Test files and test utilities" },
  docs: { name: "docs", description: "Documentation files" },
  doc: { name: "docs", description: "Documentation files" },
};

/**
 * Analyze a directory listing and produce a module map.
 * This is a heuristic-based static analysis — no LLM needed.
 *
 * Strategy:
 * - Each top-level directory under `src/` becomes its own module.
 * - Files directly in `src/` go to a "core" module.
 * - Well-known root directories (test, docs, etc.) get named modules.
 * - Everything else goes to `unmapped`.
 */
export function buildModuleMap(entries: DirectoryEntry[]): ModuleMap {
  if (entries.length === 0) {
    return { projectPath: "", modules: [], unmapped: [] };
  }

  // Buckets: moduleName → paths[]
  const buckets = new Map<string, { description: string; paths: string[] }>();
  const unmapped: string[] = [];

  function ensureBucket(name: string, description: string): string[] {
    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = { description, paths: [] };
      buckets.set(name, bucket);
    }
    return bucket.paths;
  }

  for (const e of entries) {
    const segments = e.path.split("/");
    const topLevel = segments[0];

    if (topLevel === "src") {
      if (segments.length === 1) {
        // The src directory itself — skip, it's not a file
        continue;
      }
      if (segments.length === 2 && !e.isDirectory) {
        // File directly in src/ → core module
        ensureBucket("core", "Core source files in the project root").push(
          e.path,
        );
      } else {
        // Something under src/<subdir>/... → module named after subdir
        const subdir = segments[1];
        ensureBucket(subdir, `Source code for the ${subdir} module`).push(
          e.path,
        );
      }
    } else if (topLevel in KNOWN_MODULES) {
      const { name, description } = KNOWN_MODULES[topLevel];
      ensureBucket(name, description).push(e.path);
    } else {
      unmapped.push(e.path);
    }
  }

  const modules: ModuleEntry[] = [];
  for (const [name, { description, paths }] of buckets) {
    modules.push({
      name,
      paths,
      description,
      dependencies: [], // Static analysis doesn't resolve imports
    });
  }

  return { projectPath: "", modules, unmapped };
}

/**
 * Check if two modules have overlapping file boundaries.
 */
export function hasOverlap(a: ModuleEntry, b: ModuleEntry): boolean {
  const setB = new Set(b.paths);
  return a.paths.some((p) => setB.has(p));
}

/**
 * Assign agents to non-overlapping modules for parallel work.
 * Simple round-robin distribution.
 */
export function assignModules(
  map: ModuleMap,
  agentCount: number,
): Map<number, ModuleEntry[]> {
  const result = new Map<number, ModuleEntry[]>();
  for (let i = 0; i < agentCount; i++) {
    result.set(i, []);
  }
  for (let i = 0; i < map.modules.length; i++) {
    const agentId = i % agentCount;
    result.get(agentId)!.push(map.modules[i]);
  }
  return result;
}
