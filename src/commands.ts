import pc from "picocolors";

// ── commands/ sub-modules (Phase 1 of commands.ts split — 2026-04-19) ──
import {
  parseCommand,
  type CommandContext,
  type CommandResult,
} from "./commands/shared.js";
import { handleMemoryCommand } from "./commands/memory.js";
import { handleIdentityCommand } from "./commands/identity.js";
import { handleRulesCommand } from "./commands/rules.js";
import { handleWorkflowsCommand } from "./commands/workflows.js";
import { handleAkitCommand } from "./commands/akit.js";
import { handleToolsCommand } from "./commands/tools.js";
import { handleSkillsCommand } from "./commands/skills.js";
import { handleEvalCommand } from "./commands/eval.js";
import { handleTeamCommand } from "./commands/team.js";
import { handleDelegateCommand } from "./commands/delegate.js";
import { handleAgentsCommand } from "./commands/agents.js";
import { handleOrchestrateCommand } from "./commands/orchestrate.js";
import { handleGitHubCommand } from "./commands/github.js";
import { handleStatusCommand, handleDoctorCommand } from "./commands/status.js";
import {
  handleHelp,
  handleSave,
  handleReset,
  handleUpdate,
  handleDecisionsCommand,
  handleExportCommand,
  handleDebugCommand,
} from "./commands/meta.js";
import { handleProfileCommand } from "./commands/profile.js";
import { handlePlanCommand } from "./commands/plan.js";
import { handleReminderCommand } from "./commands/reminder.js";
import { handleShowcaseCommand } from "./commands/showcase.js";
import { handleFileCommand } from "./commands/file.js";
import { handleObserveCommand } from "./commands/observe.js";
import { handlePostmortemCommand } from "./commands/postmortem.js";
import { handleWorkspacesCommand } from "./commands/workspaces.js";

// Preserve the previous export surface so external callers and tests that
// imported `CommandContext`/`CommandResult` from `./commands.js` keep working.
export type { CommandContext, CommandResult };

const KNOWN_COMMANDS = new Set([
  "quit", "exit", "q", "help", "clear", "model", "identity", "rules",
  "workflows", "tools", "akit", "skills", "eval", "memory", "status", "doctor",
  "save", "decisions", "export", "debug", "reset", "reminder",
  "update", "upgrade", "plan", "profile", "delegate", "team", "agents", "showcase", "file",
  "observe", "postmortem", "orchestrate", "orch", "github",
  "workspaces",
]);

export async function handleCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { handled: false };

  const { base, action, args } = parseCommand(trimmed);

  // Don't treat file paths (e.g., /Users/...) as commands
  if (!KNOWN_COMMANDS.has(base)) return { handled: false };

  switch (base) {
    case "quit":
    case "exit":
    case "q":
      return { handled: true, quit: true };
    case "help":
      return handleHelp();
    case "clear":
      return { handled: true, output: pc.dim("Conversation cleared."), clearHistory: true };
    case "model":
      return { handled: true, output: ctx.model ? `Model: ${pc.bold(ctx.model)}` : "Model: unknown" };
    case "identity":
      return handleIdentityCommand(action, args, ctx);
    case "rules":
      return handleRulesCommand(action, args, ctx);
    case "workflows":
      return handleWorkflowsCommand(action, args, ctx);
    case "tools":
      return handleToolsCommand(action, args, ctx);
    case "akit":
      return handleAkitCommand(action, args);
    case "skills":
      return handleSkillsCommand(action, args, ctx);
    case "eval":
      return handleEvalCommand(action, args, ctx);
    case "memory":
      return handleMemoryCommand(action, args, ctx);
    case "status":
      return handleStatusCommand(ctx);
    case "doctor":
      return handleDoctorCommand(ctx);
    case "save":
      return handleSave();
    case "decisions":
      return handleDecisionsCommand(action, args, ctx);
    case "export":
      return handleExportCommand();
    case "debug":
      return handleDebugCommand();
    case "reset":
      return handleReset(action);
    case "plan":
      return handlePlanCommand(action, args, ctx);
    case "profile":
      return handleProfileCommand(action, args);
    case "delegate":
      return handleDelegateCommand(action, args, ctx);
    case "team":
      return handleTeamCommand(action, args, ctx);
    case "agents":
      return handleAgentsCommand(action, args);
    case "reminder":
      return handleReminderCommand(action, args);
    case "showcase":
      return handleShowcaseCommand(action, args);
    case "file":
      return handleFileCommand(action, args);
    case "update":
    case "upgrade":
      return handleUpdate();
    case "observe":
      return handleObserveCommand(action, ctx);
    case "postmortem":
      return handlePostmortemCommand(action, args, ctx);
    case "orchestrate":
    case "orch":
      return handleOrchestrateCommand(action, args, ctx);
    case "github":
      return handleGitHubCommand(action, args, ctx);
    case "workspaces":
      return handleWorkspacesCommand(action, args, ctx);
    default:
      return { handled: false };
  }
}
