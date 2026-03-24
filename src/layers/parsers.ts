import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const home = os.homedir();

interface LayerStatus {
  name: string;
  exists: boolean;
  path: string;
  summary: string;
}

export interface EcosystemStatus {
  layers: LayerStatus[];
  mcpConnected: boolean;
  mcpToolCount: number;
  amemConnected: boolean;
}

const LAYER_FILES = [
  { name: "identity", dir: ".acore", file: "core.md" },
  { name: "rules", dir: ".arules", file: "rules.md" },
  { name: "workflows", dir: ".aflow", file: "flow.md" },
  { name: "tools", dir: ".akit", file: "kit.md" },
  { name: "skills", dir: ".askill", file: "skills.md" },
  { name: "eval", dir: ".aeval", file: "eval.md" },
] as const;

function countLines(content: string, pattern: RegExp): number {
  return (content.match(pattern) || []).length;
}

function getLayerSummary(name: string, content: string): string {
  switch (name) {
    case "identity": {
      const nameMatch = content.match(/^# (.+)/m);
      return nameMatch ? nameMatch[1] : "configured";
    }
    case "rules":
      return `${countLines(content, /^- /gm)} rules`;
    case "workflows":
      return `${countLines(content, /^## /gm)} workflows`;
    case "tools":
      return `${countLines(content, /^- \*\*/gm)} tools`;
    case "skills":
      return `${countLines(content, /^### /gm)} skills`;
    case "eval": {
      const sessions = countLines(content, /^### Session/gm);
      return `${sessions} sessions logged`;
    }
    default:
      return "unknown";
  }
}

export function getEcosystemStatus(
  mcpToolCount: number,
  amemConnected: boolean,
): EcosystemStatus {
  const layers: LayerStatus[] = LAYER_FILES.map((entry) => {
    const filePath = path.join(home, entry.dir, entry.file);
    const exists = fs.existsSync(filePath);
    let summary = "not configured";

    if (exists) {
      const content = fs.readFileSync(filePath, "utf-8");
      summary = getLayerSummary(entry.name, content);
    }

    return { name: entry.name, exists, path: filePath, summary };
  });

  return {
    layers,
    mcpConnected: mcpToolCount > 0,
    mcpToolCount,
    amemConnected,
  };
}

export function readLayerFile(name: string): string | null {
  const entry = LAYER_FILES.find((l) => l.name === name);
  if (!entry) return null;
  const filePath = path.join(home, entry.dir, entry.file);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8").trim();
}
