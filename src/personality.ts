import type { McpManager } from "./mcp/client.js";
import { log } from "./logger.js";

export interface PersonalityState {
  currentRead: string;
  energy: "high-drive" | "steady" | "reflective";
  activeMode: "Default" | "Focused Work" | "Creative" | "Personal";
  sleepReminder: boolean;
}

interface PersonalitySignals {
  timePeriod: string;       // late-night, morning, afternoon, evening, night
  sessionMinutes: number;   // how long this session has been running
  turnCount: number;        // number of conversation turns
  lastSessionGap?: number;  // hours since last session (from memory)
}

/**
 * Compute personality state from current signals.
 * Pure function — no side effects.
 */
export function computePersonality(signals: PersonalitySignals): PersonalityState {
  const { timePeriod, sessionMinutes, turnCount } = signals;

  // Energy curve: derives from time of day + session length
  let energy: PersonalityState["energy"] = "steady";
  if (timePeriod === "morning") {
    energy = "high-drive";
  } else if (timePeriod === "late-night" || (timePeriod === "night" && sessionMinutes > 45)) {
    energy = "reflective";
  } else if (timePeriod === "afternoon" && turnCount > 20) {
    energy = "reflective"; // afternoon fade after long session
  }

  // Active mode inference from time
  let activeMode: PersonalityState["activeMode"] = "Default";
  if (timePeriod === "late-night") {
    activeMode = "Personal"; // late night → warm, patient
  }

  // Current read: natural language description
  const readParts: string[] = [];

  switch (timePeriod) {
    case "late-night":
      readParts.push("late night session");
      if (sessionMinutes > 60) readParts.push("been going a while");
      else readParts.push("quiet hours");
      break;
    case "morning":
      readParts.push("fresh morning start");
      if (turnCount <= 3) readParts.push("just getting started");
      else readParts.push("building momentum");
      break;
    case "afternoon":
      readParts.push("afternoon session");
      if (turnCount > 15) readParts.push("deep in flow");
      else readParts.push("steady pace");
      break;
    case "evening":
      readParts.push("evening wind-down");
      if (sessionMinutes > 60) readParts.push("long session");
      break;
    case "night":
      readParts.push("night session");
      if (sessionMinutes > 45) readParts.push("getting late");
      break;
  }

  const currentRead = readParts.join(", ");

  // Sleep guardian: trigger if late-night + long session
  const sleepReminder =
    (timePeriod === "late-night" && sessionMinutes > 60) ||
    (timePeriod === "night" && sessionMinutes > 90);

  return { currentRead, energy, activeMode, sleepReminder };
}

/**
 * Format a sleep guardian nudge for injection into the system prompt.
 */
export function formatSleepNudge(): string {
  return `<health-awareness>
The user has been in a late-night session for over an hour. When there's a natural pause, gently mention they might want to wrap up soon — but don't be pushy or interrupt their flow. One brief mention is enough.
</health-awareness>`;
}

/**
 * Push current personality state to acore via identity_update_dynamics.
 * Fire-and-forget — failures are logged but don't block.
 */
export async function syncPersonalityToCore(
  state: PersonalityState,
  mcpManager: McpManager,
): Promise<void> {
  try {
    await mcpManager.callTool("identity_update_dynamics", {
      currentRead: state.currentRead,
      energy: state.energy,
      activeMode: state.activeMode,
    });
  } catch (err) {
    log.debug("personality", "identity_update_dynamics failed", err);
  }
}
