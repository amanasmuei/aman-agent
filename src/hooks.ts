import pc from "picocolors";
import * as p from "@clack/prompts";
import type { McpManager } from "./mcp/client.js";
import type { Message } from "./llm/types.js";
import type { HooksConfig } from "./config.js";

export interface HookContext {
  mcpManager: McpManager;
  config: HooksConfig;
}

let isHookCall = false;

export async function onSessionStart(
  ctx: HookContext,
): Promise<{ greeting?: string; contextInjection?: string }> {
  let greeting = "";
  let contextInjection = "";

  if (ctx.config.memoryRecall) {
    try {
      isHookCall = true;
      const result = await ctx.mcpManager.callTool("memory_context", {});
      if (result && !result.startsWith("Error")) {
        greeting += result;
      }
    } catch {
      // skip silently
    } finally {
      isHookCall = false;
    }
  }

  if (ctx.config.sessionResume) {
    try {
      isHookCall = true;
      const result = await ctx.mcpManager.callTool("identity_summary", {});
      if (result && !result.startsWith("Error")) {
        if (greeting) greeting += "\n";
        greeting += result;
      }
    } catch {
      // skip silently
    } finally {
      isHookCall = false;
    }
  }

  if (greeting) {
    contextInjection = `<session-context>\n${greeting}\n</session-context>`;
  }

  return {
    greeting: greeting || undefined,
    contextInjection: contextInjection || undefined,
  };
}

export async function onBeforeToolExec(
  toolName: string,
  toolArgs: Record<string, unknown>,
  ctx: HookContext,
): Promise<{ allow: boolean; reason?: string }> {
  if (!ctx.config.rulesCheck || isHookCall) {
    return { allow: true };
  }

  if (toolName === "rules_check") {
    return { allow: true };
  }

  try {
    isHookCall = true;
    const description = `${toolName}(${JSON.stringify(toolArgs)})`;
    const result = await ctx.mcpManager.callTool("rules_check", {
      action: description,
    });

    try {
      const parsed = JSON.parse(result) as {
        violations?: string[];
      };
      if (parsed.violations && parsed.violations.length > 0) {
        return {
          allow: false,
          reason: parsed.violations.join("; "),
        };
      }
    } catch {
      // Parse error — allow
    }

    return { allow: true };
  } catch {
    return { allow: true };
  } finally {
    isHookCall = false;
  }
}

export async function onWorkflowMatch(
  userInput: string,
  ctx: HookContext,
): Promise<{ name: string; steps: string } | null> {
  if (!ctx.config.workflowSuggest) {
    return null;
  }

  try {
    isHookCall = true;
    const result = await ctx.mcpManager.callTool("workflow_list", {});

    const workflows = JSON.parse(result) as Array<{
      name: string;
      description?: string;
      steps?: string[];
    }>;

    const inputLower = userInput.toLowerCase();

    for (const wf of workflows) {
      const nameLower = wf.name.toLowerCase();

      // Check if user input contains workflow name
      if (inputLower.includes(nameLower)) {
        const steps = (wf.steps || [])
          .map((s, i) => `${i + 1}. ${s}`)
          .join("\n");
        return { name: wf.name, steps };
      }

      // Check significant words from description
      if (wf.description) {
        const words = wf.description
          .split(/\s+/)
          .filter((w) => w.length > 4)
          .map((w) => w.toLowerCase());

        for (const word of words) {
          if (inputLower.includes(word)) {
            const steps = (wf.steps || [])
              .map((s, i) => `${i + 1}. ${s}`)
              .join("\n");
            return { name: wf.name, steps };
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    isHookCall = false;
  }
}

export async function onSessionEnd(
  ctx: HookContext,
  messages: Message[],
): Promise<void> {
  try {
    if (ctx.config.evalPrompt) {
      const rating = await p.select({
        message: "Quick rating for this session?",
        options: [
          { value: "great", label: "Great" },
          { value: "good", label: "Good" },
          { value: "okay", label: "Okay" },
          { value: "skip", label: "Skip" },
        ],
        initialValue: "skip",
      });

      if (!p.isCancel(rating) && rating !== "skip") {
        try {
          isHookCall = true;
          await ctx.mcpManager.callTool("eval_log", {
            rating: rating as string,
            highlights: "Quick session rating",
            improvements: "",
          });
        } finally {
          isHookCall = false;
        }
      }
    }

    if (ctx.config.autoSessionSave && messages.length > 2) {
      // Extract last user message as resume hint
      let lastUserMsg = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        if (
          messages[i].role === "user" &&
          typeof messages[i].content === "string"
        ) {
          lastUserMsg = messages[i].content as string;
          break;
        }
      }

      if (lastUserMsg) {
        try {
          isHookCall = true;
          await ctx.mcpManager.callTool("identity_update_session", {
            resume: lastUserMsg.slice(0, 200),
            topics: "See conversation history",
            decisions: "See conversation history",
          });
        } finally {
          isHookCall = false;
        }
      }
    }
  } catch {
    // Skip if non-interactive or fails
  }
}
