import type { ToolDefinition } from "../llm/types.js";

interface ProfileLike {
  name: string;
  personality: string;
}

interface TeamMemberLike {
  profile: string;
}

interface TeamLike {
  name: string;
  workflow: string;
  members: TeamMemberLike[];
}

/**
 * Assemble the `delegate_task` and `team_run` virtual tool definitions from
 * the user's installed profiles and teams. Caller appends these to the real
 * tool list so the LLM can invoke them like any other tool.
 *
 * Returns an empty array if there are no profiles AND no teams.
 */
export function buildVirtualTools(
  profiles: ProfileLike[],
  teams: TeamLike[],
): ToolDefinition[] {
  const virtualTools: ToolDefinition[] = [];

  if (profiles.length > 0) {
    virtualTools.push({
      name: "delegate_task",
      description: `Delegate a task to a specialist sub-agent with a different profile. Available profiles: ${profiles.map((p) => `${p.name} (${p.personality})`).join(", ")}. IMPORTANT: Always ask the user for permission before delegating.`,
      input_schema: {
        type: "object",
        properties: {
          profile: { type: "string", description: "Profile name to delegate to" },
          task: { type: "string", description: "The task description for the sub-agent" },
        },
        required: ["profile", "task"],
      },
    });
  }

  if (teams.length > 0) {
    virtualTools.push({
      name: "team_run",
      description: `Run a task with a named agent team. Available teams: ${teams.map((t) => `${t.name} (${t.workflow}: ${t.members.map((m) => m.profile).join("\u2192")})`).join(", ")}. IMPORTANT: Always ask the user for permission before running a team.`,
      input_schema: {
        type: "object",
        properties: {
          team: { type: "string", description: "Team name" },
          task: { type: "string", description: "The task for the team" },
        },
        required: ["team", "task"],
      },
    });
  }

  return virtualTools;
}
