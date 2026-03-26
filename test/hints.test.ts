import { describe, it, expect, beforeEach } from "vitest";
import { getHint, type HintState } from "../src/hints.js";

describe("hints", () => {
  let state: HintState;

  beforeEach(() => {
    state = { turnCount: 0, shownHints: new Set(), hintShownThisSession: false };
  });

  it("returns null when hints already shown this session", () => {
    state.hintShownThisSession = true;
    state.turnCount = 10;
    expect(getHint(state, { hasWorkflows: false, memoryCount: 0 })).toBeNull();
  });

  it("returns workflow hint at turn 5 when no workflows", () => {
    state.turnCount = 5;
    const hint = getHint(state, { hasWorkflows: false, memoryCount: 0 });
    expect(hint).toContain("/workflows");
  });

  it("returns memory hint at turn 3 when 10+ memories", () => {
    state.turnCount = 3;
    const hint = getHint(state, { hasWorkflows: true, memoryCount: 15 });
    expect(hint).toContain("/memory search");
  });

  it("returns rules hint at turn 8", () => {
    state.turnCount = 8;
    const hint = getHint(state, { hasWorkflows: true, memoryCount: 0 });
    expect(hint).toContain("/rules");
  });

  it("returns eval hint at turn 15", () => {
    state.turnCount = 15;
    const hint = getHint(state, { hasWorkflows: true, memoryCount: 0 });
    expect(hint).toContain("/eval");
  });

  it("does not repeat hints", () => {
    state.turnCount = 5;
    const hint1 = getHint(state, { hasWorkflows: false, memoryCount: 0 });
    expect(hint1).toBeTruthy();
    state.shownHints.add("workflows");
    state.hintShownThisSession = true;
    state.turnCount = 5;
    const hint2 = getHint(state, { hasWorkflows: false, memoryCount: 0 });
    expect(hint2).toBeNull();
  });

  it("returns null before any hint threshold", () => {
    state.turnCount = 1;
    expect(getHint(state, { hasWorkflows: false, memoryCount: 0 })).toBeNull();
  });
});
