import pc from "picocolors";
import {
  createPlan,
  getActivePlan,
  listPlans,
  loadPlan,
  markStepDone,
  markStepUndone,
  setActivePlan,
  formatPlan,
} from "../plans.js";
import { recordEvent } from "../observation.js";
import type { CommandContext, CommandResult } from "./shared.js";

export function handlePlanCommand(action: string | undefined, args: string[], ctx?: CommandContext): CommandResult {
  if (!action) {
    const active = getActivePlan();
    if (!active) {
      return { handled: true, output: pc.dim("No active plan. Create one with: /plan create <name> | <goal> | <step1>, <step2>, ...") };
    }
    return { handled: true, output: formatPlan(active) };
  }

  switch (action) {
    case "create": {
      const fullArgs = args.join(" ");
      const parts = fullArgs.split("|").map((p) => p.trim());
      if (parts.length < 3) {
        return { handled: true, output: pc.yellow("Usage: /plan create <name> | <goal> | <step1>, <step2>, ...") };
      }
      const name = parts[0];
      const goal = parts[1];
      const steps = parts[2].split(",").map((s) => s.trim()).filter(Boolean);
      if (steps.length === 0) {
        return { handled: true, output: pc.yellow("Need at least one step. Separate steps with commas.") };
      }
      const plan = createPlan(name, goal, steps);
      return { handled: true, output: pc.green(`Plan created!\n\n`) + formatPlan(plan) };
    }

    case "done": {
      const active = getActivePlan();
      if (!active) return { handled: true, output: pc.yellow("No active plan.") };

      const recordPlanMilestone = (stepIndex: number) => {
        if (ctx?.observationSession) {
          const step = active.steps[stepIndex];
          recordEvent(ctx.observationSession, {
            type: "milestone",
            summary: `Plan step done: ${step.text}`,
            data: { plan: active.name, stepIndex, stepText: step.text },
          });
        }
      };

      if (args.length > 0) {
        const stepNum = parseInt(args[0], 10);
        if (isNaN(stepNum) || stepNum < 1 || stepNum > active.steps.length) {
          return { handled: true, output: pc.yellow(`Invalid step number. Range: 1-${active.steps.length}`) };
        }
        markStepDone(active, stepNum - 1);
        recordPlanMilestone(stepNum - 1);
        return { handled: true, output: pc.green(`Step ${stepNum} done!`) + "\n\n" + formatPlan(active) };
      }

      const next = active.steps.findIndex((s) => !s.done);
      if (next < 0) return { handled: true, output: pc.green("All steps already complete!") };
      markStepDone(active, next);
      recordPlanMilestone(next);
      return { handled: true, output: pc.green(`Step ${next + 1} done!`) + "\n\n" + formatPlan(active) };
    }

    case "undo": {
      const active = getActivePlan();
      if (!active) return { handled: true, output: pc.yellow("No active plan.") };
      const stepNum = parseInt(args[0], 10);
      if (isNaN(stepNum) || stepNum < 1 || stepNum > active.steps.length) {
        return { handled: true, output: pc.yellow(`Invalid step number. Range: 1-${active.steps.length}`) };
      }
      markStepUndone(active, stepNum - 1);
      return { handled: true, output: pc.dim(`Step ${stepNum} unmarked.`) + "\n\n" + formatPlan(active) };
    }

    case "list": {
      const plans = listPlans();
      if (plans.length === 0) return { handled: true, output: pc.dim("No plans yet.") };
      const lines = plans.map((p) => {
        const done = p.steps.filter((s) => s.done).length;
        const total = p.steps.length;
        const status = p.active ? pc.green("active") : pc.dim("inactive");
        return `  ${p.name} \u2014 ${done}/${total} steps (${status})`;
      });
      return { handled: true, output: "Plans:\n" + lines.join("\n") };
    }

    case "switch": {
      const name = args.join(" ");
      if (!name) return { handled: true, output: pc.yellow("Usage: /plan switch <name>") };
      const plan = setActivePlan(name);
      if (!plan) return { handled: true, output: pc.red(`Plan not found: ${name}`) };
      return { handled: true, output: pc.green(`Switched to: ${plan.name}`) + "\n\n" + formatPlan(plan) };
    }

    case "show": {
      const name = args.join(" ");
      if (!name) return { handled: true, output: pc.yellow("Usage: /plan show <name>") };
      const plan = loadPlan(name);
      if (!plan) return { handled: true, output: pc.red(`Plan not found: ${name}`) };
      return { handled: true, output: formatPlan(plan) };
    }

    case "help":
      return { handled: true, output: `Plan commands:
  /plan               Show active plan
  /plan create <name> | <goal> | <step1>, <step2>, ...
  /plan done [step#]  Mark step complete (next if no number)
  /plan undo <step#>  Unmark a step
  /plan list          List all plans
  /plan switch <name> Switch active plan
  /plan show <name>   Show a specific plan` };

    default:
      return { handled: true, output: pc.yellow(`Unknown plan action: ${action}. Try /plan help`) };
  }
}
