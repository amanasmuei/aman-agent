import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadUserModel,
  saveUserModel,
  createEmptyModel,
  aggregateSession,
  computeProfile,
  feedForward,
  type UserModel,
  type SessionSnapshot,
  type UserProfile,
} from "../src/user-model.js";

let testDir: string;

beforeEach(async () => {
  testDir = path.join(
    os.tmpdir(),
    `user-model-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

// ── Helpers ──

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: `test-${Math.random().toString(36).slice(2)}`,
    date: "2026-04-11",
    durationMinutes: 30,
    turnCount: 15,
    dominantSentiment: "neutral",
    avgFrustration: 0.1,
    avgExcitement: 0.3,
    avgConfusion: 0.05,
    avgFatigue: 0.1,
    toolCalls: 10,
    toolErrors: 0,
    blockers: 0,
    milestones: 1,
    topicShifts: 2,
    peakEnergy: "steady",
    primaryMode: "Default",
    timePeriod: "afternoon",
    rating: "good",
    hadPostmortem: false,
    wellbeingNudges: [],
    ...overrides,
  };
}

function makeSnapshotsN(n: number, overrides: Partial<SessionSnapshot> = {}): SessionSnapshot[] {
  return Array.from({ length: n }, (_, i) =>
    makeSnapshot({ sessionId: `session-${i}`, ...overrides }),
  );
}

// ── createEmptyModel ──

describe("createEmptyModel", () => {
  it("returns valid empty model with version 1", () => {
    const model = createEmptyModel();
    expect(model.version).toBe(1);
    expect(model.sessions).toEqual([]);
    expect(model.profile.trustScore).toBe(0.5);
    expect(model.profile.totalSessions).toBe(0);
    expect(model.createdAt).toBeTruthy();
    expect(model.updatedAt).toBeTruthy();
  });
});

// ── loadUserModel / saveUserModel ──

describe("loadUserModel", () => {
  it("returns null when file doesn't exist", async () => {
    const result = await loadUserModel(path.join(testDir, "nope.json"));
    expect(result).toBeNull();
  });

  it("returns null for corrupted JSON", async () => {
    const filePath = path.join(testDir, "user-model.json");
    await fs.writeFile(filePath, "{ broken json", "utf-8");
    const result = await loadUserModel(filePath);
    expect(result).toBeNull();
  });

  it("returns null for wrong version", async () => {
    const filePath = path.join(testDir, "user-model.json");
    await fs.writeFile(filePath, JSON.stringify({ version: 99 }), "utf-8");
    const result = await loadUserModel(filePath);
    expect(result).toBeNull();
  });
});

describe("saveUserModel + loadUserModel roundtrip", () => {
  it("writes and reads back identical model", async () => {
    const filePath = path.join(testDir, "user-model.json");
    const model = createEmptyModel();
    model.sessions.push(makeSnapshot());

    await saveUserModel(model, filePath);
    const loaded = await loadUserModel(filePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.sessions).toHaveLength(1);
    expect(loaded!.profile.totalSessions).toBe(model.profile.totalSessions);
  });

  it("creates parent directories if needed", async () => {
    const filePath = path.join(testDir, "nested", "deep", "user-model.json");
    const model = createEmptyModel();
    await saveUserModel(model, filePath);
    const loaded = await loadUserModel(filePath);
    expect(loaded).not.toBeNull();
  });
});

// ── aggregateSession ──

describe("aggregateSession", () => {
  it("adds snapshot to empty model", () => {
    const model = createEmptyModel();
    const snapshot = makeSnapshot({ rating: "great" });
    const updated = aggregateSession(model, snapshot);

    expect(updated.sessions).toHaveLength(1);
    expect(updated.profile.totalSessions).toBe(1);
    expect(updated.updatedAt).toBeTruthy();
  });

  it("respects 30-session rolling window", () => {
    let model = createEmptyModel();
    for (let i = 0; i < 35; i++) {
      model = aggregateSession(model, makeSnapshot({ sessionId: `s-${i}` }));
    }

    expect(model.sessions).toHaveLength(30);
    // Oldest should be s-5 (dropped s-0 through s-4)
    expect(model.sessions[0].sessionId).toBe("s-5");
    expect(model.sessions[29].sessionId).toBe("s-34");
    expect(model.profile.totalSessions).toBe(35);
  });

  it("recomputes profile after aggregation", () => {
    let model = createEmptyModel();
    model = aggregateSession(model, makeSnapshot({ rating: "great", avgFrustration: 0 }));
    model = aggregateSession(model, makeSnapshot({ rating: "great", avgFrustration: 0 }));
    model = aggregateSession(model, makeSnapshot({ rating: "great", avgFrustration: 0 }));

    expect(model.profile.trustScore).toBeGreaterThan(0.7);
    expect(model.profile.baselineFrustration).toBeLessThan(0.1);
  });
});

// ── computeProfile ──

describe("computeProfile", () => {
  describe("trust score", () => {
    it("rises with consistently great ratings", () => {
      const sessions = makeSnapshotsN(10, { rating: "great", avgFrustration: 0, blockers: 0 });
      const profile = computeProfile(sessions, 10);
      expect(profile.trustScore).toBeGreaterThan(0.85);
      expect(profile.trustTrajectory).toBe("stable"); // All great, no change
    });

    it("drops with frustrating sessions", () => {
      const good = makeSnapshotsN(5, { rating: "great" });
      const bad = makeSnapshotsN(5, { rating: "frustrating", avgFrustration: 0.8 });
      const profile = computeProfile([...good, ...bad], 10);
      expect(profile.trustScore).toBeLessThan(0.5);
      expect(profile.trustTrajectory).toBe("declining");
    });

    it("infers trust from implicit signals when no rating given", () => {
      const sessions = makeSnapshotsN(5, {
        rating: undefined,
        avgFrustration: 0.05,
        toolErrors: 0,
        blockers: 0,
        milestones: 2,
      });
      const profile = computeProfile(sessions, 5);
      // Low frustration + milestones → good implicit signal
      expect(profile.trustScore).toBeGreaterThan(0.7);
    });
  });

  describe("sentiment baseline", () => {
    it("computes rolling average frustration", () => {
      const sessions = makeSnapshotsN(10, { avgFrustration: 0.3 });
      const profile = computeProfile(sessions, 10);
      expect(profile.baselineFrustration).toBeCloseTo(0.3, 1);
    });

    it("detects improving sentiment trend", () => {
      const sessions = makeSnapshotsN(10).map((s, i) => ({
        ...s,
        avgFrustration: 0.8 - i * 0.07, // decreasing frustration
      }));
      const profile = computeProfile(sessions, 10);
      expect(profile.sentimentTrend).toBe("improving");
    });

    it("detects worsening sentiment trend", () => {
      const sessions = makeSnapshotsN(10).map((s, i) => ({
        ...s,
        avgFrustration: 0.1 + i * 0.07, // increasing frustration
      }));
      const profile = computeProfile(sessions, 10);
      expect(profile.sentimentTrend).toBe("worsening");
    });
  });

  describe("energy distribution", () => {
    it("identifies preferred time period", () => {
      const sessions = [
        ...makeSnapshotsN(7, { timePeriod: "late-night" }),
        ...makeSnapshotsN(3, { timePeriod: "morning" }),
      ];
      const profile = computeProfile(sessions, 10);
      expect(profile.preferredTimePeriod).toBe("late-night");
      expect(profile.energyDistribution["late-night"]).toBe(7);
      expect(profile.energyDistribution["morning"]).toBe(3);
    });

    it("computes average session duration", () => {
      const sessions = makeSnapshotsN(5, { durationMinutes: 40 });
      const profile = computeProfile(sessions, 5);
      expect(profile.avgSessionMinutes).toBeCloseTo(40, 0);
    });
  });

  describe("engagement", () => {
    it("computes average turns per session", () => {
      const sessions = makeSnapshotsN(5, { turnCount: 20 });
      const profile = computeProfile(sessions, 5);
      expect(profile.avgTurnsPerSession).toBe(20);
    });

    it("detects increasing engagement", () => {
      const sessions = makeSnapshotsN(10).map((s, i) => ({
        ...s,
        turnCount: 5 + i * 3, // 5, 8, 11, ...
      }));
      const profile = computeProfile(sessions, 10);
      expect(profile.engagementTrend).toBe("increasing");
    });
  });

  describe("frustration correlations", () => {
    it("detects tool error correlation with frustration", () => {
      const sessions = makeSnapshotsN(15).map((s, i) => ({
        ...s,
        avgFrustration: i < 8 ? 0.1 : 0.8, // low then high
        toolErrors: i < 8 ? 0 : 5,           // none then many — correlated
      }));
      const profile = computeProfile(sessions, 15);
      expect(profile.frustrationCorrelations.toolErrors).toBeGreaterThan(0.4);
    });

    it("returns zero correlation when no pattern exists", () => {
      const sessions = makeSnapshotsN(10, { avgFrustration: 0.3, toolErrors: 1 });
      const profile = computeProfile(sessions, 10);
      // Constant values → no correlation
      expect(Math.abs(profile.frustrationCorrelations.toolErrors)).toBeLessThan(0.1);
    });
  });

  describe("nudge stats", () => {
    it("aggregates nudge firing frequency", () => {
      const sessions = [
        makeSnapshot({ wellbeingNudges: ["sleep", "rest"], rating: "good" }),
        makeSnapshot({ wellbeingNudges: ["sleep"], rating: "okay" }),
        makeSnapshot({ wellbeingNudges: [], rating: "great" }),
      ];
      const profile = computeProfile(sessions, 3);
      expect(profile.nudgeStats["sleep"].fired).toBe(2);
      expect(profile.nudgeStats["rest"].fired).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("handles empty sessions array", () => {
      const profile = computeProfile([], 0);
      expect(profile.trustScore).toBe(0.5);
      expect(profile.totalSessions).toBe(0);
      expect(profile.sentimentTrend).toBe("stable");
    });

    it("handles single session", () => {
      const sessions = [makeSnapshot({ rating: "great" })];
      const profile = computeProfile(sessions, 1);
      expect(profile.totalSessions).toBe(1);
      expect(profile.trustTrajectory).toBe("stable"); // Not enough data
    });
  });
});

// ── feedForward ──

describe("feedForward", () => {
  it("returns null overrides for empty model", () => {
    const model = createEmptyModel();
    const overrides = feedForward(model);
    expect(overrides).toBeNull();
  });

  it("returns null overrides for model with < 5 sessions", () => {
    let model = createEmptyModel();
    for (let i = 0; i < 4; i++) {
      model = aggregateSession(model, makeSnapshot());
    }
    const overrides = feedForward(model);
    expect(overrides).toBeNull();
  });

  it("calibrates late-night energy for night owls", () => {
    let model = createEmptyModel();
    // 8 out of 10 sessions are late-night, low frustration
    for (let i = 0; i < 8; i++) {
      model = aggregateSession(
        model,
        makeSnapshot({ timePeriod: "late-night", avgFrustration: 0.05, rating: "great" }),
      );
    }
    for (let i = 0; i < 2; i++) {
      model = aggregateSession(model, makeSnapshot({ timePeriod: "morning", rating: "good" }));
    }

    const overrides = feedForward(model);
    expect(overrides).not.toBeNull();
    // Night owl: should not force "reflective" for late-night
    expect(overrides!.energyOverride).toBe("steady");
  });

  it("lowers frustration threshold when tool errors correlate", () => {
    let model = createEmptyModel();
    // Build correlated data: high tool errors → high frustration
    for (let i = 0; i < 10; i++) {
      model = aggregateSession(
        model,
        makeSnapshot({
          toolErrors: i > 5 ? 5 : 0,
          avgFrustration: i > 5 ? 0.7 : 0.1,
          rating: i > 5 ? "frustrating" : "good",
        }),
      );
    }

    const overrides = feedForward(model);
    expect(overrides).not.toBeNull();
    expect(overrides!.frustrationNudgeThreshold).toBeLessThan(0.6);
  });

  it("sets attentive mode when sentiment is worsening", () => {
    let model = createEmptyModel();
    for (let i = 0; i < 10; i++) {
      model = aggregateSession(
        model,
        makeSnapshot({
          avgFrustration: 0.1 + i * 0.07, // escalating
          rating: i > 5 ? "okay" : "good",
        }),
      );
    }

    const overrides = feedForward(model);
    expect(overrides).not.toBeNull();
    expect(overrides!.defaultToPersonalMode).toBe(true);
  });

  it("returns compact greeting flag for high trust", () => {
    let model = createEmptyModel();
    for (let i = 0; i < 10; i++) {
      model = aggregateSession(
        model,
        makeSnapshot({ rating: "great", avgFrustration: 0, milestones: 2 }),
      );
    }

    const overrides = feedForward(model);
    expect(overrides).not.toBeNull();
    expect(overrides!.compactGreeting).toBe(true);
  });
});

// shouldFireNudge tests (from personality.ts, depends on UserProfile)
import { shouldFireNudge } from "../src/personality.js";

describe("shouldFireNudge", () => {
  it("returns true when no profile provided", () => {
    expect(shouldFireNudge("sleep")).toBe(true);
  });

  it("returns true when nudge type has fewer than 5 fires", () => {
    const profile = computeProfile([], 0);
    profile.nudgeStats["sleep"] = { fired: 3, sessionRatingAfter: 0.2 };
    expect(shouldFireNudge("sleep", profile)).toBe(true);
  });

  it("suppresses nudge when fired 5+ times with low avg rating", () => {
    const profile = computeProfile([], 0);
    profile.nudgeStats["break-frustrated"] = { fired: 6, sessionRatingAfter: 0.3 };
    expect(shouldFireNudge("break-frustrated", profile)).toBe(false);
  });

  it("allows nudge when fired 5+ times with good avg rating", () => {
    const profile = computeProfile([], 0);
    profile.nudgeStats["sleep"] = { fired: 8, sessionRatingAfter: 0.7 };
    expect(shouldFireNudge("sleep", profile)).toBe(true);
  });

  it("returns true for unknown nudge types", () => {
    const profile = computeProfile([], 0);
    expect(shouldFireNudge("nonexistent-type", profile)).toBe(true);
  });
});

import { predictBurnout } from "../src/user-model.js";

describe("predictBurnout", () => {
  const makeSession = (overrides: Partial<import("../src/user-model.js").SessionSnapshot> = {}): import("../src/user-model.js").SessionSnapshot => ({
    sessionId: "test",
    date: "2026-04-11",
    durationMinutes: 60,
    turnCount: 20,
    avgFrustration: 0.2,
    avgExcitement: 0.5,
    avgConfusion: 0.1,
    avgFatigue: 0.1,
    toolCalls: 10,
    toolErrors: 1,
    blockers: 0,
    milestones: 1,
    topicShifts: 1,
    peakEnergy: "steady",
    primaryMode: "Default",
    timePeriod: "morning",
    rating: "good",
    hadPostmortem: false,
    wellbeingNudges: [],
    ...overrides,
  });

  it("returns 0 risk with fewer than 3 sessions", () => {
    const result = predictBurnout([makeSession()]);
    expect(result.risk).toBe(0);
  });

  it("detects high burnout risk from multiple factors", () => {
    const sessions = [
      makeSession({ avgFrustration: 0.2, rating: "good", timePeriod: "morning", durationMinutes: 60 }),
      makeSession({ avgFrustration: 0.3, rating: "okay", timePeriod: "night", durationMinutes: 100 }),
      makeSession({ avgFrustration: 0.5, rating: "frustrating", timePeriod: "late-night", durationMinutes: 120, blockers: 2 }),
      makeSession({ avgFrustration: 0.6, rating: "frustrating", timePeriod: "late-night", durationMinutes: 130, blockers: 3 }),
      makeSession({ avgFrustration: 0.7, rating: "frustrating", timePeriod: "night", durationMinutes: 110, blockers: 2 }),
    ];
    const result = predictBurnout(sessions);
    expect(result.risk).toBeGreaterThan(0.5);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it("returns low risk for healthy sessions", () => {
    const sessions = Array.from({ length: 5 }, () =>
      makeSession({ avgFrustration: 0.1, rating: "great", durationMinutes: 45, timePeriod: "morning" })
    );
    const result = predictBurnout(sessions);
    expect(result.risk).toBeLessThan(0.3);
  });

  it("includes recommendation for high risk", () => {
    const sessions = [
      makeSession({ avgFrustration: 0.2, rating: "okay" }),
      makeSession({ avgFrustration: 0.4, rating: "frustrating", durationMinutes: 120, timePeriod: "late-night", blockers: 2 }),
      makeSession({ avgFrustration: 0.6, rating: "frustrating", durationMinutes: 150, timePeriod: "late-night", blockers: 3 }),
      makeSession({ avgFrustration: 0.7, rating: "frustrating", durationMinutes: 140, timePeriod: "night", blockers: 2 }),
    ];
    const result = predictBurnout(sessions, { minutes: 150, frustration: 0.7, timePeriod: "late-night" });
    expect(result.recommendation).toBeDefined();
  });
});
