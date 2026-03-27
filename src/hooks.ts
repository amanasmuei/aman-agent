import pc from "picocolors";
import * as p from "@clack/prompts";
import type { McpManager } from "./mcp/client.js";
import type { Message } from "./llm/types.js";
import type { HooksConfig } from "./config.js";
import { log } from "./logger.js";

function getTimeContext(): string {
  const now = new Date();
  const hour = now.getHours();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day = days[now.getDay()];

  let period: string;
  if (hour < 6) period = "late-night";
  else if (hour < 12) period = "morning";
  else if (hour < 17) period = "afternoon";
  else if (hour < 21) period = "evening";
  else period = "night";

  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString();

  return `<time-context>\nCurrent time: ${dateStr} ${timeStr} (${period}, ${day})\nAdapt your tone naturally — don't announce the time, just be contextually appropriate.\n</time-context>`;
}

export interface HookContext {
  mcpManager: McpManager;
  config: HooksConfig;
}

let isHookCall = false;

export async function onSessionStart(
  ctx: HookContext,
): Promise<{ greeting?: string; contextInjection?: string; firstRun?: boolean; visibleReminders?: string[]; resumeTopic?: string }> {
  let greeting = "";
  let contextInjection = "";
  let firstRun = false;
  let resumeTopic: string | undefined;
  const visibleReminders: string[] = [];

  // Detect first run via memory_recall
  try {
    isHookCall = true;
    const recallResult = await ctx.mcpManager.callTool("memory_recall", { query: "*", limit: 1 });
    if (!recallResult || recallResult.startsWith("Error") || recallResult.includes("No memories found")) {
      firstRun = true;
    }
  } catch {
    firstRun = true;
  } finally {
    isHookCall = false;
  }

  if (firstRun) {
    // First-run context injection
    contextInjection = `<first-session>
This is your FIRST conversation with this user. Introduce yourself warmly:
- Share your name and that you're their personal AI companion
- Mention you'll remember what matters across conversations
- Ask what they'd like to be called
- Keep it to 3-4 sentences, natural tone
</first-session>`;

    // Still add time context
    const timeContext = getTimeContext();
    contextInjection = `<session-context>\n${timeContext}\n</session-context>\n${contextInjection}`;

    return {
      greeting: undefined,
      contextInjection,
      firstRun,
      visibleReminders,
      resumeTopic: undefined,
    };
  }

  // Returning user flow
  if (ctx.config.memoryRecall) {
    try {
      isHookCall = true;
      const result = await ctx.mcpManager.callTool("memory_context", { topic: "session context" });
      if (result && !result.startsWith("Error")) {
        greeting += result;
      }
    } catch (err) {
      log.warn("hooks", "memory_context recall failed", err);
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

        // Extract resume topic
        const topicMatch = result.match(/(?:resume|last|topic)[:\s]*(.+?)(?:\n|$)/i);
        if (topicMatch) {
          resumeTopic = topicMatch[1].trim();
        }
      }
    } catch (err) {
      log.warn("hooks", "identity_summary failed", err);
    } finally {
      isHookCall = false;
    }
  }

  // Time context
  const timeContext = getTimeContext();
  if (greeting) greeting += "\n" + timeContext;
  else greeting = timeContext;

  // Check reminders
  try {
    isHookCall = true;
    const reminderResult = await ctx.mcpManager.callTool("reminder_check", {});
    if (reminderResult && !reminderResult.startsWith("Error") && !reminderResult.includes("No pending")) {
      greeting += "\n\n<pending-reminders>\n" + reminderResult + "\n</pending-reminders>";

      // Parse reminder lines into visible reminders
      const lines = reminderResult.split("\n").filter((l: string) => l.trim().length > 0);
      for (const line of lines) {
        visibleReminders.push(line.trim());
      }
    }
  } catch (err) {
    log.debug("hooks", "reminder_check failed", err);
  } finally {
    isHookCall = false;
  }

  if (greeting) {
    contextInjection = `<session-context>\n${greeting}\n</session-context>`;
  }

  return {
    greeting: greeting || undefined,
    contextInjection: contextInjection || undefined,
    firstRun,
    visibleReminders,
    resumeTopic,
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
    } catch (err) {
      log.debug("hooks", "rules_check parse failed", err);
    }

    return { allow: true };
  } catch (err) {
    log.warn("hooks", "rules_check call failed", err);
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
  } catch (err) {
    log.debug("hooks", "workflow_list failed", err);
    return null;
  } finally {
    isHookCall = false;
  }
}

export async function onSessionEnd(
  ctx: HookContext,
  messages: Message[],
  sessionId: string,
): Promise<void> {
  try {
    // Auto-save conversation to amem memory_log
    if (ctx.config.autoSessionSave && messages.length > 2) {
      console.log(pc.dim("\n  Saving conversation to memory..."));

      // Save last 50 text messages to memory_log
      const textMessages = messages
        .filter((m) => typeof m.content === "string")
        .slice(-50);

      for (const msg of textMessages) {
        try {
          isHookCall = true;
          await ctx.mcpManager.callTool("memory_log", {
            session_id: sessionId,
            role: msg.role,
            content: (msg.content as string).slice(0, 5000),
          });
        } catch (err) {
          log.debug("hooks", "memory_log write failed for " + sessionId, err);
        } finally {
          isHookCall = false;
        }
      }

      // Update session resume in identity
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

      console.log(pc.dim(`  Saved ${textMessages.length} messages (session: ${sessionId})`));
    }

    // Session rating prompt
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
  } catch (err) {
    log.warn("hooks", "session end hook failed", err);
  }
}
