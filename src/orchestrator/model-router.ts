import type { LLMClient } from "../llm/types.js";
import type { ModelTier, TaskNode } from "./types.js";

// ── Profile → tier mapping sets ─────────────────────────────────────
export const ADVANCED_PROFILES = new Set(["architect", "planner", "designer"]);
export const FAST_PROFILES = new Set(["linter", "formatter", "validator"]);

// ── ModelRouter interface ───────────────────────────────────────────
export interface ModelRouter {
  getClient(tier: ModelTier): LLMClient;
}

export interface ModelRouterClients {
  fast?: LLMClient;
  standard: LLMClient; // required, used as fallback
  advanced?: LLMClient;
}

// ── Factory ─────────────────────────────────────────────────────────
export function createModelRouter(clients: ModelRouterClients): ModelRouter {
  return {
    getClient(tier: ModelTier): LLMClient {
      if (tier === "fast") return clients.fast ?? clients.standard;
      if (tier === "advanced") return clients.advanced ?? clients.standard;
      return clients.standard;
    },
  };
}

// ── Tier suggestion based on task profile ───────────────────────────
export function suggestTier(node: TaskNode): ModelTier {
  if (ADVANCED_PROFILES.has(node.profile)) return "advanced";
  if (FAST_PROFILES.has(node.profile)) return "fast";
  return "standard";
}
