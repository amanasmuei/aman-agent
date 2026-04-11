import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { log } from "./logger.js";

// ── Types ──

export interface SessionSnapshot {
  sessionId: string;
  date: string;
  durationMinutes: number;
  turnCount: number;

  dominantSentiment: string;
  avgFrustration: number;
  avgExcitement: number;
  avgConfusion: number;
  avgFatigue: number;

  toolCalls: number;
  toolErrors: number;
  blockers: number;
  milestones: number;
  topicShifts: number;

  peakEnergy: string;
  primaryMode: string;
  timePeriod: string;

  rating?: string;
  hadPostmortem: boolean;
  wellbeingNudges: string[];
}

export interface UserProfile {
  trustScore: number;
  trustTrajectory: "ascending" | "stable" | "declining";
  totalSessions: number;

  preferredTimePeriod: string;
  energyDistribution: Record<string, number>;
  avgSessionMinutes: number;

  baselineFrustration: number;
  baselineExcitement: number;
  sentimentTrend: "improving" | "stable" | "worsening";

  frustrationCorrelations: {
    toolErrors: number;
    longSessions: number;
    lateNight: number;
  };

  avgTurnsPerSession: number;
  engagementTrend: "increasing" | "stable" | "decreasing";

  nudgeStats: Record<string, { fired: number; sessionRatingAfter: number }>;
}

export interface UserModel {
  version: 1;
  sessions: SessionSnapshot[];
  profile: UserProfile;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalityOverrides {
  energyOverride?: string;
  compactGreeting: boolean;
  frustrationNudgeThreshold: number;
  defaultToPersonalMode: boolean;
}

// ── Constants ──

const MAX_SESSIONS = 30;
const TRUST_ALPHA = 0.3;
const MIN_SESSIONS_FOR_FEED_FORWARD = 5;
const MIN_SESSIONS_FOR_CORRELATIONS = 10;

// ── Default model path ──

export function defaultModelPath(): string {
  return path.join(os.homedir(), ".acore", "user-model.json");
}

// ── Factory ──

export function createEmptyModel(): UserModel {
  const now = new Date().toISOString();
  return {
    version: 1,
    sessions: [],
    profile: emptyProfile(),
    createdAt: now,
    updatedAt: now,
  };
}

function emptyProfile(): UserProfile {
  return {
    trustScore: 0.5,
    trustTrajectory: "stable",
    totalSessions: 0,
    preferredTimePeriod: "afternoon",
    energyDistribution: {},
    avgSessionMinutes: 0,
    baselineFrustration: 0,
    baselineExcitement: 0,
    sentimentTrend: "stable",
    frustrationCorrelations: { toolErrors: 0, longSessions: 0, lateNight: 0 },
    avgTurnsPerSession: 0,
    engagementTrend: "stable",
    nudgeStats: {},
  };
}

// ── I/O ──

export async function loadUserModel(filePath?: string): Promise<UserModel | null> {
  const fp = filePath ?? defaultModelPath();
  try {
    const raw = await fs.readFile(fp, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return null;
    return parsed as UserModel;
  } catch {
    return null;
  }
}

export async function saveUserModel(model: UserModel, filePath?: string): Promise<void> {
  const fp = filePath ?? defaultModelPath();
  const dir = path.dirname(fp);
  await fs.mkdir(dir, { recursive: true });

  const tmp = fp + `.tmp-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(model, null, 2), "utf-8");
  await fs.rename(tmp, fp);
}

// ── Aggregation ──

export function aggregateSession(model: UserModel, snapshot: SessionSnapshot): UserModel {
  const sessions = [...model.sessions, snapshot];

  // Enforce rolling window
  while (sessions.length > MAX_SESSIONS) {
    sessions.shift();
  }

  const totalSessions = model.profile.totalSessions + 1;
  const profile = computeProfile(sessions, totalSessions);

  return {
    ...model,
    sessions,
    profile,
    updatedAt: new Date().toISOString(),
  };
}

// ── Profile Computation ──

export function computeProfile(sessions: SessionSnapshot[], totalSessions: number): UserProfile {
  if (sessions.length === 0) return { ...emptyProfile(), totalSessions };

  const n = sessions.length;

  // ── Trust Score (EMA) ──
  let trustScore = 0.5;
  for (const s of sessions) {
    trustScore = TRUST_ALPHA * ratingSignal(s) + (1 - TRUST_ALPHA) * trustScore;
  }

  // Trust trajectory: compare last 5 vs previous 5
  const trustTrajectory = computeTrustTrajectory(sessions);

  // ── Sentiment Baselines ──
  const baselineFrustration = avg(sessions.map((s) => s.avgFrustration));
  const baselineExcitement = avg(sessions.map((s) => s.avgExcitement));
  const sentimentTrend = computeSentimentTrend(sessions);

  // ── Energy Distribution ──
  const energyDistribution: Record<string, number> = {};
  for (const s of sessions) {
    energyDistribution[s.timePeriod] = (energyDistribution[s.timePeriod] || 0) + 1;
  }
  const preferredTimePeriod = Object.entries(energyDistribution).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0] ?? "afternoon";

  // ── Session Duration ──
  const avgSessionMinutes = avg(sessions.map((s) => s.durationMinutes));

  // ── Engagement ──
  const avgTurnsPerSession = avg(sessions.map((s) => s.turnCount));
  const engagementTrend = computeLinearTrend(sessions.map((s) => s.turnCount));

  // ── Frustration Correlations ──
  const frustrationCorrelations =
    n >= MIN_SESSIONS_FOR_CORRELATIONS
      ? {
          toolErrors: pearsonR(
            sessions.map((s) => s.avgFrustration),
            sessions.map((s) => s.toolErrors),
          ),
          longSessions: pearsonR(
            sessions.map((s) => s.avgFrustration),
            sessions.map((s) => s.durationMinutes),
          ),
          lateNight: pearsonR(
            sessions.map((s) => s.avgFrustration),
            sessions.map((s) => (s.timePeriod === "late-night" || s.timePeriod === "night" ? 1 : 0)),
          ),
        }
      : { toolErrors: 0, longSessions: 0, lateNight: 0 };

  // ── Nudge Stats ──
  const nudgeStats: Record<string, { fired: number; sessionRatingAfter: number }> = {};
  for (const s of sessions) {
    const ratingVal = ratingToNumber(s.rating);
    for (const nudge of s.wellbeingNudges) {
      if (!nudgeStats[nudge]) nudgeStats[nudge] = { fired: 0, sessionRatingAfter: 0 };
      nudgeStats[nudge].fired++;
      nudgeStats[nudge].sessionRatingAfter += ratingVal;
    }
  }
  for (const key of Object.keys(nudgeStats)) {
    if (nudgeStats[key].fired > 0) {
      nudgeStats[key].sessionRatingAfter /= nudgeStats[key].fired;
    }
  }

  return {
    trustScore,
    trustTrajectory,
    totalSessions,
    preferredTimePeriod,
    energyDistribution,
    avgSessionMinutes,
    baselineFrustration,
    baselineExcitement,
    sentimentTrend,
    frustrationCorrelations,
    avgTurnsPerSession,
    engagementTrend,
    nudgeStats,
  };
}

// ── Feed-Forward ──

export function feedForward(model: UserModel): PersonalityOverrides | null {
  if (model.profile.totalSessions < MIN_SESSIONS_FOR_FEED_FORWARD) return null;

  const p = model.profile;
  const overrides: PersonalityOverrides = {
    compactGreeting: false,
    frustrationNudgeThreshold: 0.6,
    defaultToPersonalMode: false,
  };

  // Night owl calibration: if 70%+ sessions are late-night/night with low frustration,
  // don't default to "reflective" — use "steady"
  const nightSessions =
    (p.energyDistribution["late-night"] || 0) + (p.energyDistribution["night"] || 0);
  const totalInWindow = model.sessions.length;
  if (totalInWindow > 0 && nightSessions / totalInWindow >= 0.7 && p.baselineFrustration < 0.3) {
    overrides.energyOverride = "steady";
  }

  // High trust → compact greeting
  if (p.trustScore > 0.8) {
    overrides.compactGreeting = true;
  }

  // Tool error frustration correlation → lower nudge threshold
  if (p.frustrationCorrelations.toolErrors > 0.4) {
    overrides.frustrationNudgeThreshold = 0.4;
  }

  // Worsening sentiment → default to Personal mode more readily
  if (p.sentimentTrend === "worsening") {
    overrides.defaultToPersonalMode = true;
  }

  return overrides;
}

// ── Burnout Predictor ──

export interface BurnoutPrediction {
  risk: number; // 0-1
  factors: string[];
  recommendation?: string;
}

/**
 * Predict burnout risk from session patterns.
 * Looks at recent 7 sessions for:
 * - Rising frustration trend
 * - Declining session ratings
 * - Long sessions without breaks
 * - Late-night clustering
 * - High blocker frequency
 */
export function predictBurnout(
  sessions: SessionSnapshot[],
  currentSession?: { minutes: number; frustration: number; timePeriod: string },
): BurnoutPrediction {
  const recent = sessions.slice(-7);
  if (recent.length < 3) {
    return { risk: 0, factors: [] };
  }

  const factors: string[] = [];
  let risk = 0;

  // Factor 1: Rising frustration (compare first half vs second half)
  const mid = Math.floor(recent.length / 2);
  const firstHalf = recent.slice(0, mid);
  const secondHalf = recent.slice(mid);
  const avgFrustFirst = avg(firstHalf.map((s) => s.avgFrustration));
  const avgFrustSecond = avg(secondHalf.map((s) => s.avgFrustration));
  if (avgFrustSecond > avgFrustFirst + 0.1 && avgFrustSecond > 0.4) {
    risk += 0.25;
    factors.push("rising frustration trend");
  }

  // Factor 2: Declining ratings
  const ratings = recent.filter((s) => s.rating).map((s) => ratingSignal(s));
  if (ratings.length >= 3) {
    const lastThree = ratings.slice(-3);
    const avgLast3 = avg(lastThree);
    if (avgLast3 < 0.5) {
      risk += 0.2;
      factors.push("low recent ratings");
    }
  }

  // Factor 3: Long sessions (avg > 90 min)
  const avgMins = avg(recent.map((s) => s.durationMinutes));
  if (avgMins > 90) {
    risk += 0.15;
    factors.push("consistently long sessions");
  }

  // Factor 4: Late-night clustering
  const lateNightCount = recent.filter((s) => s.timePeriod === "late-night" || s.timePeriod === "night").length;
  if (lateNightCount / recent.length > 0.5) {
    risk += 0.15;
    factors.push("frequent late-night sessions");
  }

  // Factor 5: High blocker frequency
  const avgBlockers = avg(recent.map((s) => s.blockers));
  if (avgBlockers > 1) {
    risk += 0.15;
    factors.push("frequent blockers");
  }

  // Current session amplifier
  if (currentSession) {
    if (currentSession.minutes > 120 && currentSession.frustration > 0.5) {
      risk += 0.1;
      factors.push("current session: long + frustrated");
    }
  }

  risk = clamp(risk, 0, 1);

  let recommendation: string | undefined;
  if (risk > 0.7) {
    recommendation = "Consider taking a longer break. You've been pushing hard — rest is productive too.";
  } else if (risk > 0.5) {
    recommendation = "Watch for signs of fatigue. A change of pace or shorter sessions might help.";
  }

  return { risk, factors, recommendation };
}

// ── Math Utilities ──

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function ratingSignal(session: SessionSnapshot): number {
  if (session.rating === "great") return 1.0;
  if (session.rating === "good") return 0.75;
  if (session.rating === "okay") return 0.5;
  if (session.rating === "frustrating") return 0.25;

  // No explicit rating — infer from signals
  let implicit = 1.0;
  implicit -= session.avgFrustration * 0.4;
  implicit -= session.toolErrors > 3 ? 0.2 : 0;
  implicit -= session.blockers > 2 ? 0.2 : 0;
  implicit += session.milestones > 0 ? 0.1 : 0;
  return clamp(implicit, 0, 1);
}

function ratingToNumber(rating?: string): number {
  if (rating === "great") return 1.0;
  if (rating === "good") return 0.75;
  if (rating === "okay") return 0.5;
  if (rating === "frustrating") return 0.25;
  return 0.5;
}

function pearsonR(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;

  const mx = avg(x);
  const my = avg(y);

  let num = 0;
  let dx2 = 0;
  let dy2 = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return num / denom;
}

function computeTrustTrajectory(
  sessions: SessionSnapshot[],
): "ascending" | "stable" | "declining" {
  if (sessions.length < 10) return "stable";

  const recent5 = sessions.slice(-5).map(ratingSignal);
  const prev5 = sessions.slice(-10, -5).map(ratingSignal);

  const recentAvg = avg(recent5);
  const prevAvg = avg(prev5);
  const delta = recentAvg - prevAvg;

  if (delta > 0.1) return "ascending";
  if (delta < -0.1) return "declining";
  return "stable";
}

function computeSentimentTrend(sessions: SessionSnapshot[]): "improving" | "stable" | "worsening" {
  if (sessions.length < 5) return "stable";

  const frustrations = sessions.slice(-10).map((s) => s.avgFrustration);
  const slope = linearSlope(frustrations);

  if (slope > 0.02) return "worsening"; // frustration increasing = worsening
  if (slope < -0.02) return "improving"; // frustration decreasing = improving
  return "stable";
}

function computeLinearTrend(values: number[]): "increasing" | "stable" | "decreasing" {
  if (values.length < 5) return "stable";

  const recent = values.slice(-10);
  const slope = linearSlope(recent);

  // Normalize slope relative to mean to detect meaningful changes
  const mean = avg(recent);
  const relativeSlope = mean > 0 ? slope / mean : slope;

  if (relativeSlope > 0.03) return "increasing";
  if (relativeSlope < -0.03) return "decreasing";
  return "stable";
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}
