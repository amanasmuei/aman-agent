import { describe, it, expect } from "vitest";
import {
  createCostTracker,
  DEFAULT_TIER_COSTS,
  type CostTracker,
  type TierCost,
} from "../../src/orchestrator/cost-tracker.js";
import type { ModelTier } from "../../src/orchestrator/types.js";

describe("createCostTracker", () => {
  it("starts with zero cost and no entries", () => {
    const tracker = createCostTracker();
    expect(tracker.totalCost()).toBe(0);
    expect(tracker.entries()).toEqual([]);
  });

  it("record adds entry with calculated cost", () => {
    const tracker = createCostTracker();
    tracker.record("task-1", "standard", 1000, 500);

    const all = tracker.entries();
    expect(all).toHaveLength(1);
    expect(all[0].taskId).toBe("task-1");
    expect(all[0].tier).toBe("standard");
    expect(all[0].inputTokens).toBe(1000);
    expect(all[0].outputTokens).toBe(500);
    expect(all[0].estimatedCost).toBeGreaterThan(0);
    expect(all[0].timestamp).toBeGreaterThan(0);
  });

  it("totalCost sums all entries", () => {
    const tracker = createCostTracker();
    tracker.record("t1", "fast", 1000, 500);
    tracker.record("t2", "standard", 1000, 500);

    const entries = tracker.entries();
    const manualSum = entries.reduce((s, e) => s + e.estimatedCost, 0);
    expect(tracker.totalCost()).toBeCloseTo(manualSum, 10);
  });

  it("costByTier breaks down by tier", () => {
    const tracker = createCostTracker();
    tracker.record("t1", "fast", 1000, 500);
    tracker.record("t2", "standard", 1000, 500);
    tracker.record("t3", "advanced", 1000, 500);

    const byTier = tracker.costByTier();
    expect(byTier.fast).toBeGreaterThan(0);
    expect(byTier.standard).toBeGreaterThan(0);
    expect(byTier.advanced).toBeGreaterThan(0);
    expect(byTier.fast + byTier.standard + byTier.advanced).toBeCloseTo(
      tracker.totalCost(),
      10,
    );
  });

  it("fast tier costs less than standard for the same tokens", () => {
    const tracker = createCostTracker();
    tracker.record("t1", "fast", 10_000, 5_000);
    tracker.record("t2", "standard", 10_000, 5_000);

    const byTier = tracker.costByTier();
    expect(byTier.fast).toBeLessThan(byTier.standard);
  });

  it("standard tier costs less than advanced for the same tokens", () => {
    const tracker = createCostTracker();
    tracker.record("t1", "standard", 10_000, 5_000);
    tracker.record("t2", "advanced", 10_000, 5_000);

    const byTier = tracker.costByTier();
    expect(byTier.standard).toBeLessThan(byTier.advanced);
  });

  it("isOverBudget returns false with no budget", () => {
    const tracker = createCostTracker();
    tracker.record("t1", "advanced", 100_000, 50_000);
    expect(tracker.isOverBudget()).toBe(false);
  });

  it("isOverBudget returns false when under budget", () => {
    const tracker = createCostTracker({ budgetLimit: 100 });
    tracker.record("t1", "fast", 1000, 500);
    expect(tracker.isOverBudget()).toBe(false);
  });

  it("isOverBudget returns true when over budget", () => {
    const tracker = createCostTracker({ budgetLimit: 0.0001 });
    // Record enough tokens to exceed the tiny budget
    tracker.record("t1", "advanced", 1_000_000, 500_000);
    expect(tracker.isOverBudget()).toBe(true);
  });

  it("remainingBudget returns null with no budget", () => {
    const tracker = createCostTracker();
    expect(tracker.remainingBudget()).toBeNull();
  });

  it("remainingBudget returns correct remaining", () => {
    const tracker = createCostTracker({ budgetLimit: 10 });
    tracker.record("t1", "fast", 1000, 500);

    const remaining = tracker.remainingBudget()!;
    expect(remaining).toBeCloseTo(10 - tracker.totalCost(), 10);
    expect(remaining).toBeLessThan(10);
    expect(remaining).toBeGreaterThan(0);
  });

  it("formatSummary includes total cost and tier breakdown", () => {
    const tracker = createCostTracker();
    tracker.record("t1", "fast", 5000, 2000);
    tracker.record("t2", "standard", 3000, 1000);

    const summary = tracker.formatSummary();
    expect(summary).toContain("Total");
    expect(summary).toContain("fast");
    expect(summary).toContain("standard");
    expect(summary).toMatch(/\$/); // includes dollar signs
  });

  it("custom tier costs override defaults", () => {
    const cheapAdvanced: TierCost = {
      inputTokensPerDollar: 10_000_000,
      outputTokensPerDollar: 10_000_000,
    };
    const defaultTracker = createCostTracker();
    const customTracker = createCostTracker({
      tierCosts: { advanced: cheapAdvanced },
    });

    defaultTracker.record("t1", "advanced", 100_000, 50_000);
    customTracker.record("t1", "advanced", 100_000, 50_000);

    expect(customTracker.totalCost()).toBeLessThan(defaultTracker.totalCost());
  });
});
