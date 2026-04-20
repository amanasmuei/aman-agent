import type { Message } from "../llm/types.js";
import type { McpManager } from "../mcp/client.js";
import type { HooksConfig } from "../config.js";
import { getSessionStartTime } from "../hooks.js";
import {
  computePersonality,
  syncPersonalityToCore,
  formatWellbeingNudge,
  shouldFireNudge,
} from "../personality.js";
import {
  recordEvent,
  detectTopicShift,
  type ObservationSession,
} from "../observation.js";

export interface PersonalityRefreshInput {
  messages: Message[];
  mcpManager: McpManager;
  hooksConfig: HooksConfig;
  observationSession?: ObservationSession;
  prevSentiment: string | undefined;
  augmentedSystemPrompt: string;
}

export interface PersonalityRefreshOutput {
  augmentedSystemPrompt: string;
  prevSentiment: string | undefined;
}

/**
 * Periodic personality/sentiment refresh. Runs every 5 user turns.
 *
 * Augments the system prompt with wellbeing nudges, feed-forward v2
 * context from cross-session frustration correlations, and burnout
 * warnings. Records sentiment shifts, blockers, and topic shifts on
 * the observation session (mutated in place via recordEvent).
 *
 * Returns the new system prompt + updated prevSentiment instead of
 * mutating — the caller decides whether to adopt the new values.
 */
export async function refreshPersonality(
  input: PersonalityRefreshInput,
): Promise<PersonalityRefreshOutput> {
  const { messages, mcpManager, hooksConfig, observationSession } = input;
  let augmentedSystemPrompt = input.augmentedSystemPrompt;
  let prevSentiment = input.prevSentiment;

  const userTurnCount = messages.filter((m) => m.role === "user").length;
  if (!(hooksConfig?.personalityAdapt !== false && userTurnCount > 0 && userTurnCount % 5 === 0)) {
    return { augmentedSystemPrompt, prevSentiment };
  }

  const hour = new Date().getHours();
  let period: string;
  if (hour < 6) period = "late-night";
  else if (hour < 12) period = "morning";
  else if (hour < 17) period = "afternoon";
  else if (hour < 21) period = "evening";
  else period = "night";

  const recentUserMsgs = messages
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .slice(-5)
    .map((m) => m.content as string);

  const sessionMinutes = Math.round((Date.now() - getSessionStartTime()) / 60000);
  const state = computePersonality({
    timePeriod: period,
    sessionMinutes,
    turnCount: userTurnCount,
    recentMessages: recentUserMsgs,
  });

  syncPersonalityToCore(state, mcpManager).catch(() => {});

  if (observationSession && prevSentiment !== state.sentiment.dominant) {
    recordEvent(observationSession, {
      type: "sentiment_shift",
      summary: `${prevSentiment ?? "neutral"} \u2192 ${state.sentiment.dominant}`,
      data: { from: prevSentiment ?? "neutral", to: state.sentiment.dominant },
    });
    prevSentiment = state.sentiment.dominant;
  }

  if (observationSession && state.sentiment.frustration > 0.6) {
    recordEvent(observationSession, {
      type: "blocker",
      summary: "User expressing frustration",
      data: { frustrationLevel: state.sentiment.frustration },
    });
  }

  if (observationSession && recentUserMsgs.length >= 6) {
    const recent = recentUserMsgs.slice(-3);
    const previous = recentUserMsgs.slice(-6, -3);
    const shift = detectTopicShift(recent, previous);
    if (shift.shifted) {
      recordEvent(observationSession, {
        type: "topic_shift",
        summary: `Topics: ${shift.newTopics.join(", ")}`,
        data: { newTopics: shift.newTopics },
      });
    }
  }

  const nudge = formatWellbeingNudge(state);
  if (nudge && state.wellbeingNudge) {
    let fireNudge = true;
    try {
      const { loadUserModel, computeProfile } = await import("../user-model.js");
      const model = await loadUserModel();
      if (model && model.sessions.length >= 5) {
        const profile = computeProfile(model.sessions, model.sessions.length);
        fireNudge = shouldFireNudge(state.wellbeingNudge, profile);
      }
    } catch {
      // No model yet — always fire
    }
    if (fireNudge) {
      augmentedSystemPrompt += "\n" + nudge;
    }
  }

  // Feed-forward v2: preemptive context from frustration correlations
  try {
    const { loadUserModel, computeProfile } = await import("../user-model.js");
    const model = await loadUserModel();
    if (model && model.sessions.length >= 10) {
      const profile = computeProfile(model.sessions, model.sessions.length);
      const preemptive: string[] = [];

      const isLate = hour >= 21 || hour < 6;
      if (isLate && profile.frustrationCorrelations.lateNight > 0.4) {
        preemptive.push(
          "Based on past patterns, late-night sessions tend to increase frustration for this user. " +
          "Be extra concise, proactive about blockers, and gently suggest wrapping up if frustration rises."
        );
      }

      const sessionMins = Math.round((Date.now() - getSessionStartTime()) / 60000);
      if (sessionMins > 60 && profile.frustrationCorrelations.longSessions > 0.4) {
        preemptive.push(
          "This session is getting long and past patterns show long sessions correlate with frustration. " +
          "Proactively suggest natural breakpoints."
        );
      }

      if (preemptive.length > 0) {
        augmentedSystemPrompt += `\n<feed-forward-v2>\n${preemptive.join("\n")}\n</feed-forward-v2>`;
      }
    }
  } catch {
    // No model — skip feed-forward v2
  }

  // Burnout predictor
  try {
    const { loadUserModel, predictBurnout } = await import("../user-model.js");
    const model = await loadUserModel();
    if (model && model.sessions.length >= 5) {
      const sessionMins = Math.round((Date.now() - getSessionStartTime()) / 60000);
      const burnout = predictBurnout(model.sessions, {
        minutes: sessionMins,
        frustration: state.sentiment.frustration,
        timePeriod: period,
      });
      if (burnout.risk > 0.7) {
        const burnoutState = { ...state, wellbeingNudge: "burnout-warning" };
        const burnoutNudge = formatWellbeingNudge(burnoutState);
        if (burnoutNudge) {
          augmentedSystemPrompt += "\n" + burnoutNudge;
        }
      }
    }
  } catch {
    // No model — skip
  }

  return { augmentedSystemPrompt, prevSentiment };
}
