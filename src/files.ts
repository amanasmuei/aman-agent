import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_READ_BYTES = 50_000;
const HOME = fs.realpathSync(os.homedir());
const TMPDIR = fs.realpathSync(os.tmpdir());
const CWD = fs.realpathSync(process.cwd());

function realOrBest(p: string): string {
  // Walk up the path until we find an existing ancestor, then append the rest.
  // This handles non-existent files under symlinked directories (e.g. macOS /var → /private/var).
  const parts = p.split(path.sep);
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join(path.sep) || path.sep;
    try {
      const real = fs.realpathSync(candidate);
      const remainder = parts.slice(i).join(path.sep);
      return remainder ? `${real}${path.sep}${remainder}` : real;
    } catch {
      // keep walking up
    }
  }
  return p;
}

function isUnderDir(real: string, dir: string): boolean {
  return real === dir || real.startsWith(dir + path.sep);
}

function assertSafePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const real = realOrBest(resolved);
  if (!isUnderDir(real, HOME) && !isUnderDir(real, CWD) && !isUnderDir(real, TMPDIR)) {
    throw new Error(`Path is outside allowed directories (home or cwd): ${real}`);
  }
  return resolved;
}

export interface ReadFileResult {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  encoding: "utf-8";
}

export async function readFile(filePath: string): Promise<ReadFileResult> {
  const resolved = assertSafePath(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${resolved}. Use /file list instead.`);
  }
  const size = stat.size;
  const buf = Buffer.alloc(Math.min(size, MAX_READ_BYTES));
  const fd = fs.openSync(resolved, "r");
  try {
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return {
    path: resolved,
    content: buf.toString("utf-8"),
    size,
    truncated: size > MAX_READ_BYTES,
    encoding: "utf-8",
  };
}

export interface FileEntry {
  name: string;
  type: "file" | "dir";
  size: number;
}

export interface ListFilesResult {
  path: string;
  entries: FileEntry[];
  total: number;
}

export async function listFiles(
  dirPath: string,
  opts: { recursive?: boolean } = {}
): Promise<ListFilesResult> {
  const resolved = assertSafePath(dirPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Path is a file, not a directory: ${resolved}. Use /file read instead.`);
  }

  const entries: FileEntry[] = [];

  function walk(dir: string, prefix: string) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        entries.push({ name: rel, type: "dir", size: 0 });
        if (opts.recursive) walk(path.join(dir, item.name), rel);
      } else {
        const s = fs.statSync(path.join(dir, item.name));
        entries.push({ name: rel, type: "file", size: s.size });
      }
    }
  }

  walk(resolved, "");
  return { path: resolved, entries, total: entries.length };
}
