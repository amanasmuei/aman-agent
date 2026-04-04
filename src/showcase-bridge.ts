/**
 * Bridge to @aman_asmuei/aman-showcase.
 * Safely handles the case where the showcase package isn't installed.
 * All imports are dynamic to avoid hard dependency.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { log } from "./logger.js";

export interface ShowcaseOption {
  name: string;
  title: string;
  description: string;
  category: string;
  language: string;
  tags: string[];
}

export interface ShowcaseInstallResult {
  installed: string[];
  backed_up: string[];
  env_example: string;
}

let cachedManifest: ShowcaseOption[] | null = null;
let cachedShowcaseRoot: string | null = null;

/**
 * Find the aman-showcase package root directory.
 */
function findShowcaseRoot(): string | null {
  const candidates = [
    // Sibling in monorepo
    path.join(os.homedir(), "project-aman", "aman-showcase"),
    path.join(process.cwd(), "..", "aman-showcase"),
    // npm global install
    path.join(process.cwd(), "node_modules", "@aman_asmuei", "aman-showcase"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "src", "manifest.ts")) ||
        fs.existsSync(path.join(candidate, "dist", "index.js"))) {
      return candidate;
    }
  }

  return null;
}

/**
 * Parse showcase entries from manifest.ts source (works without building).
 */
function parseManifestSource(source: string): ShowcaseOption[] {
  const entries: ShowcaseOption[] = [];
  // Match each showcase entry object
  const regex = /\{\s*name:\s*"([^"]+)"[\s\S]*?title:\s*"([^"]+)"[\s\S]*?description:\s*"([^"]+)"[\s\S]*?category:\s*"([^"]+)"[\s\S]*?language:\s*"([^"]+)"[\s\S]*?tags:\s*\[([^\]]*)\]/g;

  let match;
  while ((match = regex.exec(source)) !== null) {
    entries.push({
      name: match[1],
      title: match[2],
      description: match[3],
      category: match[4],
      language: match[5],
      tags: match[6].split(",").map((t) => t.trim().replace(/"/g, "")).filter(Boolean),
    });
  }

  return entries;
}

/**
 * Load showcase manifest from @aman_asmuei/aman-showcase.
 * Returns empty array if the package isn't available.
 */
export function loadShowcaseManifest(): ShowcaseOption[] {
  if (cachedManifest !== null) return cachedManifest;

  const root = findShowcaseRoot();
  if (!root) {
    cachedManifest = [];
    return cachedManifest;
  }

  cachedShowcaseRoot = root;

  // Try reading manifest source directly (works without dist build)
  const manifestSrc = path.join(root, "src", "manifest.ts");
  if (fs.existsSync(manifestSrc)) {
    try {
      const content = fs.readFileSync(manifestSrc, "utf-8");
      const parsed = parseManifestSource(content);
      if (parsed.length > 0) {
        cachedManifest = parsed;
        return cachedManifest;
      }
    } catch {
      log.debug("showcase", "Failed to parse manifest.ts");
    }
  }

  // Fallback: scan directories for showcases
  try {
    const dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") &&
        !["node_modules", "dist", "src", "bin", "docs"].includes(d.name))
      .filter((d) => fs.existsSync(path.join(root, d.name, "identity")));

    cachedManifest = dirs.map((d) => ({
      name: d.name,
      title: d.name.charAt(0).toUpperCase() + d.name.slice(1),
      description: "",
      category: "other",
      language: "en",
      tags: [],
    }));
  } catch {
    cachedManifest = [];
  }

  return cachedManifest;
}

/**
 * Install a showcase template by name.
 * Copies identity, rules, workflows, and skills from the showcase package.
 */
export function installShowcaseTemplate(name: string): ShowcaseInstallResult {
  const root = cachedShowcaseRoot || findShowcaseRoot();
  if (!root) {
    throw new Error("aman-showcase package not found. Install it or check the path.");
  }

  const showcaseDir = path.join(root, name);
  if (!fs.existsSync(showcaseDir) || !fs.existsSync(path.join(showcaseDir, "identity"))) {
    throw new Error(`Showcase "${name}" not found in ${root}`);
  }

  const result: ShowcaseInstallResult = { installed: [], backed_up: [], env_example: "" };
  const home = os.homedir();

  const copies: Array<{ src: string; dest: string; label: string }> = [
    {
      src: path.join(showcaseDir, "identity", "core.md"),
      dest: path.join(home, ".acore", "core.md"),
      label: "~/.acore/core.md (identity)",
    },
    {
      src: path.join(showcaseDir, "workflows", "flow.md"),
      dest: path.join(home, ".aflow", "flow.md"),
      label: "~/.aflow/flow.md (workflows)",
    },
    {
      src: path.join(showcaseDir, "rules", "rules.md"),
      dest: path.join(home, ".arules", "rules.md"),
      label: "~/.arules/rules.md (guardrails)",
    },
  ];

  // Skills — consolidate individual skill files into ~/.askill/skills.md
  const skillsSrc = path.join(showcaseDir, "skills");
  if (fs.existsSync(skillsSrc)) {
    const skillFiles = fs.readdirSync(skillsSrc).filter((f: string) => f.endsWith(".md"));
    if (skillFiles.length > 0) {
      // Read all skill files and merge into a single skills.md
      const skillParts: string[] = [];
      for (const skillFile of skillFiles) {
        const content = fs.readFileSync(path.join(skillsSrc, skillFile), "utf-8").trim();
        if (content) skillParts.push(content);
      }

      if (skillParts.length > 0) {
        const skillsDest = path.join(home, ".askill", "skills.md");
        const consolidated = `# Skills\n\n${skillParts.join("\n\n---\n\n")}\n`;

        // Backup existing
        if (fs.existsSync(skillsDest)) {
          fs.copyFileSync(skillsDest, `${skillsDest}.bak`);
          result.backed_up.push("~/.askill/skills.md (skills)");
        }

        fs.mkdirSync(path.dirname(skillsDest), { recursive: true });
        fs.writeFileSync(skillsDest, consolidated, "utf-8");
        result.installed.push(`~/.askill/skills.md (${skillFiles.length} skill${skillFiles.length > 1 ? "s" : ""} consolidated)`);
      }
    }
  }

  for (const { src, dest, label } of copies) {
    if (!fs.existsSync(src)) continue;

    // Backup existing files
    if (fs.existsSync(dest)) {
      const backup = `${dest}.bak`;
      fs.copyFileSync(dest, backup);
      result.backed_up.push(label);
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    result.installed.push(label);
  }

  // Copy env example if present
  const envExample = path.join(showcaseDir, "config", "telegram.env.example");
  if (fs.existsSync(envExample)) {
    const destEnv = path.join(process.cwd(), ".env.example");
    fs.copyFileSync(envExample, destEnv);
    result.env_example = destEnv;
  }

  log.debug("showcase", `Installed showcase: ${name} (${result.installed.length} files)`);
  return result;
}
