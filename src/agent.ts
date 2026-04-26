import * as readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import logUpdate from "log-update";
import type {
  LLMClient,
  Message,
  ContentBlock,
  ToolDefinition,
  ToolResultBlock,
} from "./llm/types.js";
import { handleCommand } from "./commands.js";
import type { McpManager } from "./mcp/client.js";
import {
  onSessionStart,
  onBeforeToolExec,
  onWorkflowMatch,
  onSessionEnd,
  type HookContext,
} from "./hooks.js";
import type { HooksConfig } from "./config.js";
import { trimConversation } from "./context-manager.js";
import { log } from "./logger.js";
import { withRetry } from "./retry.js";
import { extractMemories as runExtraction, type ExtractorState } from "./memory-extractor.js";
import { memoryLog } from "./memory.js";
import { recallForMessage } from "./agent/recall.js";
import { generateSessionId } from "./agent/session-id.js";
import { saveConversationToMemory } from "./agent/save-conversation.js";
import { parseAttachments } from "./agent/attachments.js";
import { refreshPersonality } from "./agent/personality-refresh.js";
import { buildVirtualTools } from "./agent/virtual-tools.js";
import { createStreamHandler } from "./agent/stream-handler.js";
import { autoTriggerSkills, matchKnowledge } from "./skill-engine.js";
import { BackgroundTaskManager, shouldRunInBackground } from "./background.js";
import { getActivePlan, formatPlanForPrompt } from "./plans.js";
import { estimateTokens } from "./token-budget.js";
import { delegateTask } from "./delegate.js";
import { listProfiles } from "./prompt.js";
import { listTeams, loadTeam, runTeam, formatTeamResult } from "./teams.js";
import { humanizeError } from "./errors.js";
import { getHint, loadShownHints, saveShownHints, type HintState } from "./hints.js";
import {
  createObservationSession,
  recordEvent,
  flushEvents,
  cleanupOldObservations,
  type ObservationSession,
} from "./observation.js";
import { recordWorkspace, surfaceCurrentThread } from "./workspaces/index.js";

// markedTerminal() returns a MarkedExtension — types lag behind, cast is safe
// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.use(markedTerminal() as any);


export async function runAgent(
  client: LLMClient,
  systemPrompt: string,
  aiName: string,
  model: string,
  tools?: ToolDefinition[],
  mcpManager?: McpManager,
  hooksConfig?: HooksConfig,
): Promise<void> {
  const messages: Message[] = [];
  const sessionId = generateSessionId();
  const extractorState: ExtractorState = { turnsSinceLastExtraction: 0, lastExtractionCount: 0 };
  const bgTasks = new BackgroundTaskManager();
  let abortController: AbortController | null = null;
  let isStreaming = false;
  let lastCheckpointTurn = 0;
  const CHECKPOINT_INTERVAL = 10; // auto-save every N user turns

  // Add virtual tools for delegation and teams
  const profiles = listProfiles();
  const teams = listTeams();
  if (tools && (profiles.length > 0 || teams.length > 0)) {
    tools = [...tools, ...buildVirtualTools(profiles, teams)];
  }
  const hintState: HintState = {
    turnCount: 0,
    shownHints: loadShownHints(),
    hintShownThisSession: false,
  };

  const isRetryable = (err: Error) =>
    err.message.includes("Rate limit") ||
    err.message.includes("rate limit") ||
    err.message.includes("ECONNRESET") ||
    err.message.includes("ETIMEDOUT") ||
    err.message.includes("fetch failed") ||
    err.message.includes("socket hang up") ||
    err.message.includes("network socket disconnected") ||
    err.message.includes("ENOTFOUND") ||
    err.message.includes("EAI_AGAIN");

  const stream = createStreamHandler();
  const onChunkHandler = stream.handler;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle Ctrl+C gracefully — abort current stream or exit
  let sigintCount = 0;
  rl.on("SIGINT", async () => {
    // If streaming, abort the current response instead of exiting
    if (isStreaming && abortController) {
      abortController.abort();
      sigintCount = 0;
      process.stdout.write(pc.yellow("\n  [response cancelled]\n"));
      return;
    }

    sigintCount++;
    // Double Ctrl+C to exit
    if (sigintCount < 2) {
      process.stdout.write(pc.dim("\n  Press Ctrl+C again to exit.\n"));
      setTimeout(() => { sigintCount = 0; }, 2000);
      return;
    }

    // Wait for background tasks before exiting
    if (bgTasks.pendingCount > 0) {
      await bgTasks.waitAll();
      bgTasks.displayCompleted();
    }
    if (observationSession) {
      await flushEvents(observationSession).catch(() => {});
    }
    if (mcpManager && hooksConfig) {
      try {
        const hookCtx: HookContext = { mcpManager, config: hooksConfig, llmClient: client };
        await onSessionEnd(hookCtx, messages, sessionId, observationSession);
      } catch (err) { log.debug("agent", "session end hook failed on SIGINT", err); }
    }
    console.log(pc.dim("\nGoodbye.\n"));
    rl.close();
    process.exit(0);
  });

  const prompt = (): Promise<string> => {
    return new Promise<string>((resolve) => {
      rl.question(pc.green("\nYou > "), (answer) => {
        resolve(answer);
      });
    });
  };

  console.log(
    `\nType a message, ${pc.dim("/help")} for commands, or ${pc.dim("/quit")} to exit.\n`,
  );

  if (mcpManager && hooksConfig) {
    const hookCtx: HookContext = { mcpManager, config: hooksConfig };
    try {
      const session = await onSessionStart(hookCtx);

      if (!session.firstRun) {
        if (session.resumeTopic) {
          console.log(pc.dim(`  Welcome back. Last time we talked about ${session.resumeTopic}`));
        } else {
          console.log(pc.dim("  Welcome back."));
        }
      }

      if (session.visibleReminders && session.visibleReminders.length > 0) {
        for (const reminder of session.visibleReminders) {
          console.log(pc.yellow(`  Reminder: ${reminder}`));
        }
      }

      if (session.contextInjection) {
        messages.push({ role: "user", content: session.contextInjection });
        if (session.firstRun) {
          messages.push({ role: "assistant", content: "acknowledged" });
        } else {
          messages.push({ role: "assistant", content: "I have context from our previous sessions. How can I help?" });
        }
      }
    } catch (err) { log.warn("agent", "session start hook failed", err); }
  }

  // Initialize observation session (passive session telemetry)
  let observationSession: ObservationSession | undefined;
  let prevSentiment: string | undefined;
  if (hooksConfig?.recordObservations !== false) {
    observationSession = createObservationSession(sessionId);
    // Cleanup old observation files (non-blocking, fire-and-forget)
    cleanupOldObservations().catch(() => {});
  }

  // Workspace tracking + thread surfacing (per workspaces design spec §3.3 + §10.4).
  // Both are non-fatal: any error logs and continues — never blocks startup.
  recordWorkspace(process.cwd()).catch((err) =>
    log.warn("workspaces", "workspace tracking failed (non-fatal)", err),
  );
  if (mcpManager) {
    surfaceCurrentThread(process.cwd(), mcpManager)
      .then((msg) => {
        if (msg) {
          // Print to stderr so it surfaces visibly at session start without
          // contaminating stdout (which carries agent output).
          // Also keep a debug-log copy for trace.
          process.stderr.write(`${pc.dim(msg)}\n`);
          log.debug("workspaces", msg);
        }
      })
      .catch((err) =>
        log.warn("workspaces", "thread surfacing failed (non-fatal)", err),
      );
  }

  while (true) {
    // Check for completed background tasks — inject as proper tool results
    if (bgTasks.hasCompleted) {
      const completed = bgTasks.collectCompleted();
      const bgToolResults: ToolResultBlock[] = [];
      for (const task of completed) {
        const elapsed = ((Date.now() - task.startedAt) / 1000).toFixed(1);
        if (task.error) {
          process.stdout.write(pc.yellow(`\n  [${task.id}] ${task.toolName} failed after ${elapsed}s: ${task.error}\n`));
          bgToolResults.push({
            type: "tool_result" as const,
            tool_use_id: task.toolUseId,
            content: `[Background] ${task.toolName} failed: ${task.error}`,
            is_error: true,
          });
        } else {
          process.stdout.write(pc.green(`\n  [${task.id}] ${task.toolName} completed in ${elapsed}s\n`));
          const preview = (task.result || "").slice(0, 200);
          if (preview) {
            process.stdout.write(pc.dim(`  ${preview}${(task.result || "").length > 200 ? "..." : ""}\n`));
          }
          bgToolResults.push({
            type: "tool_result" as const,
            tool_use_id: task.toolUseId,
            content: `[Background] ${task.toolName} completed:\n${task.result}`,
          });
        }
      }
      if (bgToolResults.length > 0) {
        messages.push({ role: "user", content: bgToolResults });
      }
    }

    const input = await prompt();
    if (!input.trim()) continue;

    // Handle slash commands
    const cmdResult = await handleCommand(input, {
      model,
      mcpManager,
      llmClient: client,
      tools,
      observationSession,
      messages,
    });
    if (cmdResult.handled) {
      if (cmdResult.quit) {
        if (observationSession) {
          await flushEvents(observationSession).catch(() => {});
        }
        if (mcpManager && hooksConfig) {
          try {
            const hookCtx: HookContext = { mcpManager, config: hooksConfig, llmClient: client };
            await onSessionEnd(hookCtx, messages, sessionId, observationSession);
          } catch (err) { log.debug("agent", "session end hook failed on quit", err); }
        }
        console.log(pc.dim("\nGoodbye.\n"));
        rl.close();
        return;
      }
      if (cmdResult.exportConversation) {
        try {
          const exportDir = path.join(os.homedir(), ".aman-agent", "exports");
          fs.mkdirSync(exportDir, { recursive: true });
          const exportPath = path.join(exportDir, `${sessionId}.md`);

          const lines: string[] = [
            `# Conversation — ${new Date().toLocaleString()}`,
            `**Model:** ${model}`,
            "",
            "---",
            "",
          ];

          for (const msg of messages) {
            if (typeof msg.content === "string") {
              const label = msg.role === "user" ? "**You:**" : `**${aiName}:**`;
              lines.push(`${label} ${msg.content}`, "");
            }
          }

          fs.writeFileSync(exportPath, lines.join("\n"), "utf-8");
          console.log(pc.green(`Exported to ${exportPath}`));
        } catch {
          console.log(pc.red("Failed to export conversation."));
        }
        continue;
      }
      if (cmdResult.saveConversation) {
        try {
          await saveConversationToMemory(messages, sessionId);
          console.log(pc.green("Conversation saved to memory."));
        } catch {
          console.log(pc.red("Failed to save conversation."));
        }
        continue;
      }
      if (cmdResult.output) {
        console.log(cmdResult.output);
      }
      if (cmdResult.clearHistory) {
        messages.length = 0;
      }
      continue;
    }

    // Check for workflow match
    let activeSystemPrompt = systemPrompt;
    if (mcpManager && hooksConfig) {
      try {
        const hookCtx: HookContext = { mcpManager, config: hooksConfig };
        const wfMatch = await onWorkflowMatch(input, hookCtx);
        if (wfMatch) {
          const useIt = await new Promise<boolean>((resolve) => {
            rl.question(pc.dim(`  Workflow "${wfMatch.name}" matches. Use it? (y/N) `), (answer) => resolve(answer.toLowerCase() === "y"));
          });
          if (useIt) {
            activeSystemPrompt = systemPrompt + `\n\n<active-workflow>\n${wfMatch.steps}\n</active-workflow>`;
            console.log(pc.dim(`  Using "${wfMatch.name}" workflow.`));
          }
        }
      } catch (err) { log.debug("agent", "workflow match failed", err); }
    }

    // Inject active plan into context
    const activePlan = getActivePlan();
    if (activePlan) {
      activeSystemPrompt += "\n\n" + formatPlanForPrompt(activePlan);
    }

    // Auto-trigger skills based on conversation context
    if (mcpManager) {
      try {
        const skillContext = await autoTriggerSkills(input, mcpManager);
        if (skillContext) {
          activeSystemPrompt += "\n\n" + skillContext;
        }
      } catch (err) { log.debug("agent", "skill auto-trigger failed", err); }

      // Auto-suggest knowledge library items
      const knowledgeItem = matchKnowledge(input);
      if (knowledgeItem) {
        activeSystemPrompt += `\n\n<knowledge name="${knowledgeItem.name}" category="${knowledgeItem.category}">
${knowledgeItem.description}

${knowledgeItem.content}
</knowledge>`;
      }
    }

    // Auto-trim conversation if approaching token limits
    await trimConversation(messages, client);

    // Parse attachments (local files + image URLs) from user input.
    const { textContent, imageBlocks } = await parseAttachments(input, mcpManager);

    // Build user message: structured ContentBlock[] if images present, string otherwise
    if (imageBlocks.length > 0) {
      const blocks: ContentBlock[] = [
        { type: "text", text: textContent },
        ...imageBlocks,
      ];
      messages.push({ role: "user", content: blocks });
    } else {
      messages.push({ role: "user", content: textContent });
    }

    // Per-message memory recall
    let augmentedSystemPrompt = activeSystemPrompt;
    let memoryTokens = 0;
    {
      const recall = await recallForMessage(input);
      if (recall) {
        augmentedSystemPrompt = activeSystemPrompt + recall.text;
        memoryTokens = recall.tokenEstimate;
      }
    }

    // Personality refresh with sentiment (every 5 turns, guarded inside).
    if (mcpManager && hooksConfig) {
      const refreshed = await refreshPersonality({
        messages,
        mcpManager,
        hooksConfig,
        observationSession,
        prevSentiment,
        augmentedSystemPrompt,
      });
      augmentedSystemPrompt = refreshed.augmentedSystemPrompt;
      prevSentiment = refreshed.prevSentiment;
    }

    // Cap augmented system prompt to prevent unbounded growth
    const MAX_SYSTEM_TOKENS = 16_000;
    const systemTokens = estimateTokens(augmentedSystemPrompt);
    if (systemTokens > MAX_SYSTEM_TOKENS) {
      // Trim from the end (memories, knowledge, skills are appended last)
      const maxChars = MAX_SYSTEM_TOKENS * 4; // ~4 chars per token
      augmentedSystemPrompt = augmentedSystemPrompt.slice(0, maxChars) + "\n[... system context truncated to fit token budget]";
      log.debug("agent", `system prompt trimmed from ~${systemTokens} to ~${MAX_SYSTEM_TOKENS} tokens`);
    }

    const divider = "─".repeat(Math.min(process.stdout.columns || 60, 60) - aiName.length - 2);
    process.stdout.write(`\n ${pc.cyan(pc.bold(aiName))} ${pc.dim(divider)}\n\n`);

    try {
      abortController = new AbortController();
      isStreaming = true;
      let response = await withRetry(
        () => client.chat(augmentedSystemPrompt, messages, onChunkHandler, tools),
        { maxAttempts: 3, baseDelay: 1000, retryable: isRetryable },
      );
      isStreaming = false;

      // Add assistant message to history
      messages.push(response.message);

      // Agentic tool loop: execute tools until LLM stops requesting them
      const MAX_TOOL_TURNS = 20;
      let toolTurnCount = 0;
      while (response.toolUses.length > 0 && mcpManager) {
        toolTurnCount++;
        if (toolTurnCount > MAX_TOOL_TURNS) {
          messages.push({
            role: "assistant",
            content: "Tool execution limit reached (20). Breaking to prevent infinite loop.",
          });
          console.log(pc.yellow("\n  Tool execution limit reached (20). Breaking to prevent infinite loop."));
          break;
        }
        const toolResults: ToolResultBlock[] = await Promise.all(
          response.toolUses.map(async (toolUse) => {
            if (hooksConfig) {
              const hookCtx: HookContext = { mcpManager: mcpManager!, config: hooksConfig };
              const check = await onBeforeToolExec(toolUse.name, toolUse.input, hookCtx);
              if (!check.allow) {
                process.stdout.write(pc.red(`  [BLOCKED: ${check.reason}]\n`));
                return {
                  type: "tool_result" as const,
                  tool_use_id: toolUse.id,
                  content: `BLOCKED by guardrail: ${check.reason}`,
                  is_error: true,
                };
              }
            }

            // Handle delegate_task virtual tool
            if (toolUse.name === "delegate_task" && mcpManager) {
              const input = toolUse.input as { profile: string; task: string };
              // Confirmation: ask user before delegating
              const confirmed = await new Promise<boolean>((resolve) => {
                rl.question(
                  pc.cyan(`  Delegate to ${pc.bold(input.profile)}? `) + pc.dim(`"${input.task.slice(0, 80)}${input.task.length > 80 ? "..." : ""}" (y/N) `),
                  (answer) => resolve(answer.toLowerCase() === "y"),
                );
              });
              if (!confirmed) {
                return {
                  type: "tool_result" as const,
                  tool_use_id: toolUse.id,
                  content: "User declined delegation.",
                  is_error: true,
                };
              }
              process.stdout.write(pc.dim(`\n  [delegating to ${input.profile}...]\n\n`));
              const result = await delegateTask(input.task, input.profile, client, mcpManager, { tools, hooksConfig });
              const output = result.success
                ? `[${input.profile}] completed:\n\n${result.response}`
                : `[${input.profile}] failed: ${result.error}`;
              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: output,
              };
            }

            // Handle team_run virtual tool
            if (toolUse.name === "team_run" && mcpManager) {
              const input = toolUse.input as { team: string; task: string };
              // Confirmation: ask user before launching team
              const confirmed = await new Promise<boolean>((resolve) => {
                rl.question(
                  pc.cyan(`  Run team ${pc.bold(input.team)}? `) + pc.dim(`"${input.task.slice(0, 80)}${input.task.length > 80 ? "..." : ""}" (y/N) `),
                  (answer) => resolve(answer.toLowerCase() === "y"),
                );
              });
              if (!confirmed) {
                return {
                  type: "tool_result" as const,
                  tool_use_id: toolUse.id,
                  content: "User declined team execution.",
                  is_error: true,
                };
              }
              const team = loadTeam(input.team);
              if (!team) {
                return {
                  type: "tool_result" as const,
                  tool_use_id: toolUse.id,
                  content: `Team not found: ${input.team}`,
                  is_error: true,
                };
              }
              const result = await runTeam(team, input.task, client, mcpManager, tools);
              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: result.success
                  ? formatTeamResult(result)
                  : `Team execution failed: ${result.finalOutput}`,
              };
            }

            // Check if tool should run in background
            if (shouldRunInBackground(toolUse.name)) {
              const task = bgTasks.launch(toolUse.name, toolUse.id, mcpManager, toolUse.input);
              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: `[${toolUse.name} launched in background (${task.id}). Results will appear when ready. Continue with other work.]`,
              };
            }

            process.stdout.write(pc.dim(`  [using ${toolUse.name}...]\n`));
            const toolStartMs = Date.now();
            let result: string;
            try {
              result = await mcpManager.callTool(toolUse.name, toolUse.input);
            } catch (toolErr) {
              const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
              if (observationSession) {
                recordEvent(observationSession, {
                  type: "tool_error",
                  summary: `${toolUse.name}: ${errMsg}`,
                  data: { tool: toolUse.name, error: errMsg },
                });
              }
              throw toolErr;
            }

            // Record successful tool call observation
            if (observationSession) {
              const durationMs = Date.now() - toolStartMs;
              recordEvent(observationSession, {
                type: "tool_call",
                summary: `${toolUse.name} (${durationMs}ms)`,
                data: { tool: toolUse.name, durationMs, success: true },
              });

              // Detect file-modifying tools and record file_change events
              const FILE_TOOLS = new Set(["file_write", "file_edit", "file_create", "file_delete"]);
              if (FILE_TOOLS.has(toolUse.name)) {
                const filePath = (toolUse.input as Record<string, unknown>)?.path ?? "unknown";
                recordEvent(observationSession, {
                  type: "file_change",
                  summary: `${toolUse.name}: ${String(filePath)}`,
                  data: { tool: toolUse.name, path: filePath },
                });
              }
            }

            // Log tool observation to memory (passive capture, fire-and-forget)
            const skipLogging = ["memory_log", "memory_recall", "memory_context", "memory_detail", "reminder_check"].includes(toolUse.name);
            if (!skipLogging) {
              try {
                memoryLog(sessionId, "system", `[tool:${toolUse.name}] input=${JSON.stringify(toolUse.input).slice(0, 500)} result=${result.slice(0, 500)}`);
              } catch {}
            }

            return {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: result,
            };
          }),
        );

        // Add tool results as a user message
        messages.push({
          role: "user",
          content: toolResults,
        });

        // Trim conversation if tool results pushed us over token limits
        await trimConversation(messages, client);

        // Call LLM again with tool results
        abortController = new AbortController();
        isStreaming = true;
        response = await withRetry(
          () => client.chat(augmentedSystemPrompt, messages, onChunkHandler, tools),
          { maxAttempts: 3, baseDelay: 1000, retryable: isRetryable },
        );
        isStreaming = false;

        // Add assistant response to history
        messages.push(response.message);
      }

      // Response footer
      const footerParts: string[] = [];
      if (memoryTokens > 0) footerParts.push(`memories: ~${memoryTokens} tokens`);
      const footer = footerParts.length > 0 ? ` ${footerParts.join(" | ")}` : "";
      const footerDivider = "─".repeat(Math.min(process.stdout.columns || 60, 60) - footer.length - 1);
      process.stdout.write(pc.dim(` ${footerDivider}${footer}\n`));

      // Periodic session checkpoint (fire-and-forget — prevents data loss on crash)
      const currentTurn = messages.filter((m) => m.role === "user").length;
      if (hooksConfig?.autoSessionSave && currentTurn - lastCheckpointTurn >= CHECKPOINT_INTERVAL) {
        lastCheckpointTurn = currentTurn;
        saveConversationToMemory(messages, sessionId).catch(() => {});
        log.debug("agent", `checkpoint saved at turn ${currentTurn}`);
      }

      // Periodic flush of buffered observation events (fire-and-forget)
      if (observationSession && observationSession.events.length >= 5) {
        flushEvents(observationSession).catch(() => {});
      }

      // Memory extraction (fire-and-forget — never blocks the prompt)
      if (hooksConfig?.extractMemories) {
        const assistantText = typeof response.message.content === "string"
          ? response.message.content
          : response.message.content
              .filter((b) => b.type === "text")
              .map((b) => ("text" in b ? b.text : ""))
              .join("");

        if (assistantText) {
          runExtraction(
            input, assistantText, client, extractorState,
          ).then((count) => {
            if (count > 0) {
              process.stdout.write(pc.dim(`  [${count} memory${count > 1 ? "ies" : ""} stored]\n`));
            }
          }).catch(() => {});
        }
      } else {
        extractorState.turnsSinceLastExtraction++;
      }

      // Progressive hints
      if (hooksConfig?.featureHints) {
        hintState.turnCount++;
        const hasWorkflows = fs.existsSync(path.join(os.homedir(), ".aflow", "flow.md"));
        const memoryCount = memoryTokens > 0 ? Math.floor(memoryTokens / 5) : 0;
        const hint = getHint(hintState, { hasWorkflows, memoryCount });
        if (hint) {
          process.stdout.write(pc.dim(`  ${hint}\n`));
          saveShownHints(hintState.shownHints);
        }
      }
    } catch (error) {
      isStreaming = false;
      // If aborted by user (Ctrl+C), just add partial response and continue
      if (abortController?.signal.aborted) {
        const partial = stream.getBuffer();
        if (partial.trim()) {
          messages.push({ role: "assistant", content: partial.trim() });
          if (process.stdout.isTTY) {
            try { logUpdate(marked(partial.trim()) as string); logUpdate.done(); } catch { logUpdate.done(); }
          }
          stream.resetBuffer();
        }
        continue;
      }
      const rawMessage = error instanceof Error ? error.message : "Unknown error occurred";
      const friendly = humanizeError(rawMessage);
      console.error(pc.red(`\n  ${friendly}`));
      // Don't remove the user message — keep for retry
    }
  }
}

