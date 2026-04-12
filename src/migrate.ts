import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { homeDir } from "./config.js";

interface MigrationResult {
  migrated: string[];
}

const MIGRATION_MAP: Array<{ oldName: string; newSubdir: string }> = [
  { oldName: ".acore", newSubdir: "identity" },
  { oldName: ".arules", newSubdir: "rules" },
  { oldName: ".aflow", newSubdir: "workflows" },
  { oldName: ".askill", newSubdir: "skills" },
  { oldName: ".amem", newSubdir: "memory" },
  { oldName: ".aeval", newSubdir: "eval" },
];

/**
 * Migrate old scattered dot-directories into the consolidated ~/.aman-agent/ layout.
 * Safe: skips if new directory already has content, idempotent.
 */
export function migrateIfNeeded(): MigrationResult {
  const home = os.homedir();
  const target = homeDir();
  const migrated: string[] = [];

  for (const { oldName, newSubdir } of MIGRATION_MAP) {
    const oldDir = path.join(home, oldName);
    const newDir = path.join(target, newSubdir);

    if (!fs.existsSync(oldDir)) continue;
    if (fs.existsSync(newDir) && fs.readdirSync(newDir).length > 0) continue;

    fs.mkdirSync(newDir, { recursive: true });
    for (const entry of fs.readdirSync(oldDir)) {
      fs.renameSync(path.join(oldDir, entry), path.join(newDir, entry));
    }

    fs.rmSync(oldDir, { recursive: true, force: true });
    migrated.push(newSubdir);
  }

  return { migrated };
}
