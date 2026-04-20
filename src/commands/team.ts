import pc from "picocolors";
import {
  createTeam,
  loadTeam,
  listTeams,
  deleteTeam,
  runTeam,
  formatTeam,
  formatTeamResult,
  BUILT_IN_TEAMS,
  type Team,
} from "../teams.js";
import type { CommandContext, CommandResult } from "./shared.js";

export async function handleTeamCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  if (!action || action === "list") {
    const teams = listTeams();
    if (teams.length === 0) {
      return {
        handled: true,
        output: pc.dim("No teams yet. Create one:") +
          "\n  /team create <name>     Create from built-in template" +
          "\n  /team create            Show available templates",
      };
    }
    const lines = teams.map((t) => {
      const members = t.members.map((m) => m.profile).join(", ");
      return `  ${pc.bold(t.name)} (${t.workflow}) \u2014 ${members}`;
    });
    return { handled: true, output: "Teams:\n" + lines.join("\n") };
  }

  switch (action) {
    case "create": {
      const name = args[0];
      if (!name) {
        const lines = BUILT_IN_TEAMS.map((t) => {
          const members = t.members.map((m) => m.profile).join(" \u2192 ");
          return `  ${pc.bold(t.name)} (${t.workflow}) \u2014 ${members}\n    ${pc.dim(t.goal)}`;
        });
        return {
          handled: true,
          output: "Built-in teams:\n" + lines.join("\n\n") +
            "\n\nUsage:\n  /team create content-team     Install built-in" +
            "\n  /team create <name> <mode> <profile1:role>,<profile2:role>  Custom",
        };
      }

      const builtIn = BUILT_IN_TEAMS.find((t) => t.name === name);
      if (builtIn) {
        createTeam(builtIn);
        return { handled: true, output: pc.green(`Team installed: ${builtIn.name}`) + "\n\n" + formatTeam(builtIn) };
      }

      const mode = args[1] as Team["workflow"];
      const membersStr = args[2];
      if (!mode || !membersStr) {
        return { handled: true, output: pc.yellow("Usage: /team create <name> <pipeline|parallel|coordinator> <profile1:role>,<profile2:role>") };
      }
      if (!["pipeline", "parallel", "coordinator"].includes(mode)) {
        return { handled: true, output: pc.yellow("Mode must be: pipeline, parallel, or coordinator") };
      }

      const members = membersStr.split(",").map((m) => {
        const [profile, ...roleParts] = m.trim().split(":");
        return { profile: profile.trim(), role: roleParts.join(":").trim() || profile.trim() };
      });

      const team: Team = {
        name,
        goal: `Team: ${name}`,
        coordinator: "default",
        members,
        workflow: mode,
      };
      createTeam(team);
      return { handled: true, output: pc.green(`Team created!`) + "\n\n" + formatTeam(team) };
    }

    case "run": {
      const teamName = args[0];
      const task = args.slice(1).join(" ");
      if (!teamName || !task) {
        return { handled: true, output: pc.yellow("Usage: /team run <team-name> <task description>") };
      }

      const team = loadTeam(teamName);
      if (!team) return { handled: true, output: pc.red(`Team not found: ${teamName}`) };

      if (!ctx.llmClient || !ctx.mcpManager) {
        return { handled: true, output: pc.red("Team execution requires LLM client and MCP.") };
      }

      const result = await runTeam(team, task, ctx.llmClient, ctx.mcpManager, ctx.tools);
      return { handled: true, output: formatTeamResult(result) };
    }

    case "show": {
      const name = args[0];
      if (!name) return { handled: true, output: pc.yellow("Usage: /team show <name>") };
      const team = loadTeam(name);
      if (!team) return { handled: true, output: pc.red(`Team not found: ${name}`) };
      return { handled: true, output: formatTeam(team) };
    }

    case "delete": {
      const name = args[0];
      if (!name) return { handled: true, output: pc.yellow("Usage: /team delete <name>") };
      if (!deleteTeam(name)) return { handled: true, output: pc.red(`Team not found: ${name}`) };
      return { handled: true, output: pc.dim(`Team deleted: ${name}`) };
    }

    case "help":
      return { handled: true, output: `Team commands:
  /team                          List all teams
  /team create                   Show built-in templates
  /team create <name>            Install built-in team
  /team create <n> <mode> <m>    Custom team (mode: pipeline|parallel|coordinator)
  /team run <name> <task>        Run a task with a team
  /team show <name>              Show team details
  /team delete <name>            Delete a team

Modes:
  pipeline     Sequential: agent1 \u2192 agent2 \u2192 agent3
  parallel     All agents work concurrently, coordinator merges
  coordinator  Coordinator LLM decides how to split the task

Examples:
  /team create content-team
  /team run content-team Write a blog post about AI companions
  /team create review-squad pipeline coder:implement,researcher:review
  /team run review-squad Build a rate limiter in TypeScript` };

    default:
      return { handled: true, output: pc.yellow(`Unknown team action: ${action}. Try /team help`) };
  }
}
