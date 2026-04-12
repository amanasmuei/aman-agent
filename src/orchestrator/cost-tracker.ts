import type { ModelTier } from "./types.js";

// ── Interfaces ──────────────────────────────────────────────────────

export interface TierCost {
  inputTokensPerDollar: number;
  outputTokensPerDollar: number;
}

export interface CostEntry {
  tier: ModelTier;
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  timestamp: number;
}

export interface CostTracker {
  /** Record token usage for a task. */
  record(
    taskId: string,
    tier: ModelTier,
    inputTokens: number,
    outputTokens: number,
  ): void;

  /** Get total estimated cost. */
  totalCost(): number;

  /** Get cost breakdown by tier. */
  costByTier(): Record<ModelTier, number>;

  /** Get all entries. */
  entries(): CostEntry[];

  /** Check if budget is exceeded. */
  isOverBudget(): boolean;

  /** Get remaining budget (null if no budget set). */
  remainingBudget(): number | null;

  /** Format cost summary. */
  formatSummary(): string;
}

export interface CostTrackerOptions {
  /** Budget limit in dollars (null = unlimited). */
  budgetLimit?: number | null;
  /** Cost rates per tier (defaults provided). */
  tierCosts?: Partial<Record<ModelTier, TierCost>>;
}

// ── Default rates (approximate Claude pricing) ──────────────────────

export const DEFAULT_TIER_COSTS: Record<ModelTier, TierCost> = {
  fast: {
    inputTokensPerDollar: 5_000_000,
    outputTokensPerDollar: 1_250_000,
  }, // ~$0.20/$0.80 per 1M
  standard: {
    inputTokensPerDollar: 333_333,
    outputTokensPerDollar: 66_667,
  }, // ~$3/$15 per 1M
  advanced: {
    inputTokensPerDollar: 66_667,
    outputTokensPerDollar: 13_333,
  }, // ~$15/$75 per 1M
};

// ── Factory ─────────────────────────────────────────────────────────

export function createCostTracker(options?: CostTrackerOptions): CostTracker {
  const budgetLimit = options?.budgetLimit ?? null;
  const tierCosts: Record<ModelTier, TierCost> = {
    ...DEFAULT_TIER_COSTS,
    ...options?.tierCosts,
  };

  const _entries: CostEntry[] = [];

  function estimateCost(
    tier: ModelTier,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const rates = tierCosts[tier];
    return (
      inputTokens / rates.inputTokensPerDollar +
      outputTokens / rates.outputTokensPerDollar
    );
  }

  function record(
    taskId: string,
    tier: ModelTier,
    inputTokens: number,
    outputTokens: number,
  ): void {
    _entries.push({
      tier,
      taskId,
      inputTokens,
      outputTokens,
      estimatedCost: estimateCost(tier, inputTokens, outputTokens),
      timestamp: Date.now(),
    });
  }

  function totalCost(): number {
    return _entries.reduce((sum, e) => sum + e.estimatedCost, 0);
  }

  function costByTier(): Record<ModelTier, number> {
    const result: Record<ModelTier, number> = {
      fast: 0,
      standard: 0,
      advanced: 0,
    };
    for (const entry of _entries) {
      result[entry.tier] += entry.estimatedCost;
    }
    return result;
  }

  function entries(): CostEntry[] {
    return [..._entries];
  }

  function isOverBudget(): boolean {
    if (budgetLimit === null) return false;
    return totalCost() > budgetLimit;
  }

  function remainingBudget(): number | null {
    if (budgetLimit === null) return null;
    return budgetLimit - totalCost();
  }

  function formatSummary(): string {
    const total = totalCost();
    const byTier = costByTier();
    const lines: string[] = [];

    lines.push(`Total: $${total.toFixed(4)}`);

    for (const tier of ["fast", "standard", "advanced"] as ModelTier[]) {
      if (byTier[tier] > 0) {
        lines.push(`  ${tier}: $${byTier[tier].toFixed(4)}`);
      }
    }

    if (budgetLimit !== null) {
      const remaining = remainingBudget()!;
      lines.push(
        `Budget: $${budgetLimit.toFixed(2)} | Remaining: $${remaining.toFixed(4)}`,
      );
    }

    lines.push(`Entries: ${_entries.length}`);

    return lines.join("\n");
  }

  return {
    record,
    totalCost,
    costByTier,
    entries,
    isOverBudget,
    remainingBudget,
    formatSummary,
  };
}
