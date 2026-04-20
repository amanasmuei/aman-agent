import pc from "picocolors";
import {
  getSessionStats,
  pauseObservation,
  resumeObservation,
} from "../observation.js";
import type { CommandContext, CommandResult } from "./shared.js";

export async function handleObserveCommand(
  action: string | undefined,
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!ctx.observationSession) {
    return {
      handled: true,
      output: pc.dim("Observation is disabled. Enable with recordObservations: true in config."),
    };
  }

  switch (action) {
    case "pause":
      pauseObservation(ctx.observationSession);
      return { handled: true, output: pc.dim("Observation paused. Use /observe resume to continue.") };

    case "resume":
      resumeObservation(ctx.observationSession);
      return { handled: true, output: pc.dim("Observation resumed.") };

    default:
      return { handled: true, output: getSessionStats(ctx.observationSession) };
  }
}
