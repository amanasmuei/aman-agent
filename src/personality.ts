import type { McpManager } from "./mcp/client.js";
import { log } from "./logger.js";

export interface PersonalityState {
  currentRead: string;
  energy: "high-drive" | "steady" | "reflective";
  activeMode: "Default" | "Focused Work" | "Creative" | "Personal";
  sleepReminder: boolean;
  wellbeingNudge: string | null;
  sentiment: SentimentRead;
}

export interface SentimentRead {
  frustration: number;  // 0-1
  excitement: number;   // 0-1
  confusion: number;    // 0-1
  fatigue: number;      // 0-1
  dominant: "neutral" | "frustrated" | "excited" | "confused" | "fatigued";
}

export interface PersonalitySignals {
  timePeriod: string;
  sessionMinutes: number;
  turnCount: number;
  recentMessages?: string[];  // last N user messages for sentiment analysis
}

// --- Sentiment Detection (keyword-based, zero latency) ---

const FRUSTRATION_SIGNALS = [
  /\b(ugh|argh|damn|dammit|wtf|ffs|shit|fuck|crap|hate this|stupid|broken|still not|doesn't work|not working|won't work|keeps failing|again\?!|what the hell|for the love of|give up|giving up|fed up)\b/i,
  /\b(why (is|does|won't|can't|isn't)|same (error|issue|problem|bug)|tried everything|nothing works|no idea|lost|stuck|frustrated|annoying|impossible)\b/i,
  /!{2,}/,  // multiple exclamation marks
  /\?{2,}/, // multiple question marks (exasperation)
];

const EXCITEMENT_SIGNALS = [
  /\b(amazing|awesome|perfect|brilliant|love it|yes!|nice!|great!|finally|it works|nailed it|beautiful|incredible|exactly|that's it|hell yeah|wow|woah|let's go)\b/i,
  /\b(excited|pumped|stoked|can't wait|this is great|so cool|love this)\b/i,
  /!{1,}.*(!|🎉|🚀|✨|💪|🔥)/,
];

const CONFUSION_SIGNALS = [
  /\b(confused|don't understand|what do you mean|huh\??|makes no sense|i'm lost|unclear|what\?|how does that|wait what|can you explain|i don't get)\b/i,
  /\b(which one|what's the difference|should i|not sure (if|what|how|why|whether))\b/i,
];

const FATIGUE_SIGNALS = [
  /\b(tired|exhausted|long day|need (a )?break|calling it|wrapping up|done for (now|today)|heading (to bed|off)|good night|gn|signing off|one more thing then|last one)\b/i,
  /\b(brain (is )?fried|can't think|eyes (are )?heavy|running on fumes|barely awake)\b/i,
];

function scorePatterns(text: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const p of patterns) {
    if (p.test(text)) hits++;
  }
  return Math.min(hits / patterns.length, 1);
}

/**
 * Detect sentiment from recent user messages.
 * Lightweight keyword-based analysis — no LLM calls.
 */
export function detectSentiment(recentMessages: string[]): SentimentRead {
  if (recentMessages.length === 0) {
    return { frustration: 0, excitement: 0, confusion: 0, fatigue: 0, dominant: "neutral" };
  }

  // Weight recent messages more heavily (last message = 1.0, second-last = 0.6, third = 0.3)
  const weights = [1.0, 0.6, 0.3, 0.2, 0.1];
  let frustration = 0, excitement = 0, confusion = 0, fatigue = 0;
  let totalWeight = 0;

  for (let i = 0; i < Math.min(recentMessages.length, weights.length); i++) {
    const msg = recentMessages[recentMessages.length - 1 - i];
    const w = weights[i];
    totalWeight += w;

    frustration += scorePatterns(msg, FRUSTRATION_SIGNALS) * w;
    excitement += scorePatterns(msg, EXCITEMENT_SIGNALS) * w;
    confusion += scorePatterns(msg, CONFUSION_SIGNALS) * w;
    fatigue += scorePatterns(msg, FATIGUE_SIGNALS) * w;
  }

  if (totalWeight > 0) {
    frustration /= totalWeight;
    excitement /= totalWeight;
    confusion /= totalWeight;
    fatigue /= totalWeight;
  }

  // Determine dominant sentiment
  const scores = { frustrated: frustration, excited: excitement, confused: confusion, fatigued: fatigue };
  const maxKey = Object.entries(scores).reduce((a, b) => a[1] > b[1] ? a : b);
  const dominant = maxKey[1] > 0.15 ? maxKey[0] as SentimentRead["dominant"] : "neutral";

  return { frustration, excitement, confusion, fatigue, dominant };
}

// --- Personality Computation ---

/**
 * Compute personality state from current signals including sentiment.
 * Pure function — no side effects.
 */
export function computePersonality(signals: PersonalitySignals): PersonalityState {
  const { timePeriod, sessionMinutes, turnCount, recentMessages } = signals;

  // Detect sentiment from recent messages
  const sentiment = detectSentiment(recentMessages || []);

  // Energy curve: time + session + sentiment
  let energy: PersonalityState["energy"] = "steady";
  if (timePeriod === "morning" && sentiment.dominant !== "fatigued") {
    energy = "high-drive";
  } else if (timePeriod === "late-night" || (timePeriod === "night" && sessionMinutes > 45)) {
    energy = "reflective";
  } else if (sentiment.dominant === "fatigued") {
    energy = "reflective";
  } else if (sentiment.dominant === "excited") {
    energy = "high-drive"; // match their energy
  } else if (timePeriod === "afternoon" && turnCount > 20) {
    energy = "reflective";
  }

  // Active mode: time + sentiment
  let activeMode: PersonalityState["activeMode"] = "Default";
  if (timePeriod === "late-night") {
    activeMode = "Personal";
  } else if (sentiment.dominant === "frustrated" || sentiment.dominant === "fatigued") {
    activeMode = "Personal"; // warm, patient when they're struggling
  }

  // Current read: combines time context + sentiment
  const readParts: string[] = [];

  // Time-based read
  switch (timePeriod) {
    case "late-night":
      readParts.push("late night session");
      if (sessionMinutes > 60) readParts.push("been going a while");
      else readParts.push("quiet hours");
      break;
    case "morning":
      readParts.push("morning session");
      if (turnCount <= 3) readParts.push("just getting started");
      else readParts.push("building momentum");
      break;
    case "afternoon":
      readParts.push("afternoon session");
      if (turnCount > 15) readParts.push("deep in flow");
      else readParts.push("steady pace");
      break;
    case "evening":
      readParts.push("evening session");
      if (sessionMinutes > 60) readParts.push("long session");
      break;
    case "night":
      readParts.push("night session");
      if (sessionMinutes > 45) readParts.push("getting late");
      break;
  }

  // Sentiment-based read
  switch (sentiment.dominant) {
    case "frustrated":
      readParts.push("user seems stuck or frustrated");
      break;
    case "excited":
      readParts.push("user is energized and making progress");
      break;
    case "confused":
      readParts.push("user may need clearer explanations");
      break;
    case "fatigued":
      readParts.push("user seems tired");
      break;
  }

  const currentRead = readParts.join(", ");

  // Sleep guardian
  const sleepReminder =
    (timePeriod === "late-night" && sessionMinutes > 60) ||
    (timePeriod === "night" && sessionMinutes > 90);

  // Wellbeing nudges (beyond sleep)
  let wellbeingNudge: string | null = null;

  if (sleepReminder && sentiment.dominant === "frustrated") {
    wellbeingNudge = "sleep-frustrated";
  } else if (sleepReminder) {
    wellbeingNudge = "sleep";
  } else if (sentiment.dominant === "frustrated" && sessionMinutes > 90) {
    wellbeingNudge = "break-frustrated";
  } else if (sentiment.dominant === "frustrated" && turnCount > 15) {
    wellbeingNudge = "step-back";
  } else if (sentiment.dominant === "fatigued") {
    wellbeingNudge = "rest";
  } else if (sessionMinutes > 120) {
    wellbeingNudge = "break-long-session";
  }

  return { currentRead, energy, activeMode, sleepReminder, wellbeingNudge, sentiment };
}

// --- Wellbeing Nudge Formatting ---

const WELLBEING_NUDGES: Record<string, string> = {
  "sleep": `<wellbeing>
It's late and this session has been running a while. When there's a natural pause, gently mention they might want to wrap up soon. One brief mention is enough — don't be pushy.
</wellbeing>`,

  "sleep-frustrated": `<wellbeing>
It's late, the session has been long, and the user seems frustrated. This is a tough combination. Acknowledge what they're dealing with is hard, suggest they sleep on it — fresh eyes in the morning often solve what hours of late-night debugging can't. Be warm, not condescending.
</wellbeing>`,

  "break-frustrated": `<wellbeing>
The user has been at this for over 90 minutes and seems frustrated. If the conversation allows, gently suggest stepping away for a few minutes — a short break often unblocks what persistence can't. Frame it as a strategy, not giving up.
</wellbeing>`,

  "step-back": `<wellbeing>
The user seems stuck or frustrated. Consider: offer to re-approach the problem from a different angle, break it into smaller pieces, or explain the underlying concept. Match their directness — don't over-soothe, just help them find a way forward.
</wellbeing>`,

  "rest": `<wellbeing>
The user seems tired. Keep responses concise and to the point. If they mention wrapping up, support that. Don't add extra complexity or tangents.
</wellbeing>`,

  "break-long-session": `<wellbeing>
This session has been running for over 2 hours. If there's a natural moment, a brief mention that a short break might help maintain focus is fine. Once is enough.
</wellbeing>`,
};

/**
 * Format the appropriate wellbeing nudge for the current state.
 */
export function formatWellbeingNudge(state: PersonalityState): string | null {
  if (!state.wellbeingNudge) return null;
  return WELLBEING_NUDGES[state.wellbeingNudge] || null;
}

/**
 * Push current personality state to acore via identity_update_dynamics.
 * Optionally includes user model metrics (trust, sessions, sentiment trend).
 * Fire-and-forget — failures are logged but don't block.
 */
export async function syncPersonalityToCore(
  state: PersonalityState,
  mcpManager: McpManager,
  modelMetrics?: { trustScore: number; totalSessions: number; sentimentTrend: string },
): Promise<void> {
  try {
    const payload: Record<string, unknown> = {
      currentRead: state.currentRead,
      energy: state.energy,
      activeMode: state.activeMode,
    };
    if (modelMetrics) {
      payload.trust = `${(modelMetrics.trustScore * 100).toFixed(0)}%`;
      payload.sessions = modelMetrics.totalSessions;
      payload.sentimentTrend = modelMetrics.sentimentTrend;
    }
    await mcpManager.callTool("identity_update_dynamics", payload);
  } catch (err) {
    log.debug("personality", "identity_update_dynamics failed", err);
  }
}
