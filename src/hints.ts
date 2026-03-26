import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface HintState {
  turnCount: number;
  shownHints: Set<string>;
  hintShownThisSession: boolean;
}

interface HintContext {
  hasWorkflows: boolean;
  memoryCount: number;
}

interface HintDef {
  id: string;
  minTurn: number;
  condition: (ctx: HintContext) => boolean;
  text: string;
}

const HINTS: HintDef[] = [
  {
    id: "eval",
    minTurn: 15,
    condition: () => true,
    text: "Tip: See how our relationship has evolved with /eval",
  },
  {
    id: "memory-search",
    minTurn: 3,
    condition: (ctx) => ctx.memoryCount >= 10,
    text: "Tip: Search everything I remember with /memory search <query>",
  },
  {
    id: "workflows",
    minTurn: 5,
    condition: (ctx) => !ctx.hasWorkflows,
    text: "Tip: Teach me multi-step processes with /workflows add",
  },
  {
    id: "rules",
    minTurn: 8,
    condition: () => true,
    text: "Tip: Set guardrails for what I should/shouldn't do with /rules",
  },
];

export function getHint(state: HintState, ctx: HintContext): string | null {
  if (state.hintShownThisSession) return null;

  for (const hint of HINTS) {
    if (state.turnCount >= hint.minTurn && !state.shownHints.has(hint.id) && hint.condition(ctx)) {
      state.shownHints.add(hint.id);
      state.hintShownThisSession = true;
      return hint.text;
    }
  }

  return null;
}

const HINTS_FILE = path.join(os.homedir(), ".aman-agent", "hints-seen.json");

export function loadShownHints(): Set<string> {
  try {
    if (fs.existsSync(HINTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(HINTS_FILE, "utf-8"));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch { /* ignore */ }
  return new Set();
}

export function saveShownHints(shown: Set<string>): void {
  try {
    const dir = path.dirname(HINTS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HINTS_FILE, JSON.stringify([...shown]), "utf-8");
  } catch { /* non-critical */ }
}
