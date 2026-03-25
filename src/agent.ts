import * as readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import type {
  LLMClient,
  Message,
  ToolDefinition,
  ToolResultBlock,
  StreamChunk,
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

interface RecallResult {
  text: string;
  tokenEstimate: number;
}

async function recallForMessage(
  input: string,
  mcpManager: McpManager,
): Promise<RecallResult | null> {
  try {
    const result = await mcpManager.callTool("memory_recall", {
      query: input,
      limit: 5,
      compact: true,
    });
    if (!result || result.startsWith("Error") || result.includes("No memories found")) {
      return null;
    }
    // Estimate tokens: ~1.3 tokens per word
    const tokenEstimate = Math.round(result.split(/\s+/).filter(Boolean).length * 1.3);
    return {
      text: `\n\n<relevant-memories>\n${result}\n</relevant-memories>`,
      tokenEstimate,
    };
  } catch (err) {
    log.debug("agent", "memory recall failed", err);
    return null;
  }
}

// Generate a session ID for conversation logging
function generateSessionId(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `session-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

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

  const isRetryable = (err: Error) =>
    err.message.includes("Rate limit") ||
    err.message.includes("rate limit") ||
    err.message.includes("ECONNRESET") ||
    err.message.includes("ETIMEDOUT") ||
    err.message.includes("fetch failed");

  const onChunkHandler = (chunk: StreamChunk) => {
    if (chunk.type === "text" && chunk.text) {
      process.stdout.write(chunk.text);
    }
    if (chunk.type === "done") {
      process.stdout.write("\n");
    }
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle Ctrl+C gracefully
  rl.on("SIGINT", async () => {
    if (mcpManager && hooksConfig) {
      try {
        const hookCtx: HookContext = { mcpManager, config: hooksConfig };
        await onSessionEnd(hookCtx, messages, sessionId);
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
      if (session.greeting) console.log(pc.dim(session.greeting));
      if (session.contextInjection) {
        messages.push({ role: "user", content: session.contextInjection });
        messages.push({ role: "assistant", content: "I have context from our previous sessions. How can I help?" });
      }
    } catch (err) { log.warn("agent", "session start hook failed", err); }
  }

  while (true) {
    const input = await prompt();
    if (!input.trim()) continue;

    // Handle slash commands
    const cmdResult = await handleCommand(input, { model, mcpManager });
    if (cmdResult.handled) {
      if (cmdResult.quit) {
        if (mcpManager && hooksConfig) {
          try {
            const hookCtx: HookContext = { mcpManager, config: hooksConfig };
            await onSessionEnd(hookCtx, messages, sessionId);
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
      if (cmdResult.saveConversation && mcpManager) {
        try {
          await saveConversationToMemory(mcpManager, messages, sessionId);
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

    // Auto-trim conversation if approaching token limits
    await trimConversation(messages, client);

    // Send to LLM
    messages.push({ role: "user", content: input });

    // Per-message memory recall
    let augmentedSystemPrompt = activeSystemPrompt;
    if (mcpManager) {
      const recall = await recallForMessage(input, mcpManager);
      if (recall) {
        augmentedSystemPrompt = activeSystemPrompt + recall.text;
        process.stdout.write(pc.dim(`  [memories: ~${recall.tokenEstimate} tokens]\n`));
      }
    }

    process.stdout.write(pc.cyan(`\n${aiName} > `));

    try {
      let response = await withRetry(
        () => client.chat(augmentedSystemPrompt, messages, onChunkHandler, tools),
        { maxAttempts: 3, baseDelay: 1000, retryable: isRetryable },
      );

      // Add assistant message to history
      messages.push(response.message);

      // Agentic tool loop: execute tools until LLM stops requesting them
      while (response.toolUses.length > 0 && mcpManager) {
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

            process.stdout.write(pc.dim(`  [using ${toolUse.name}...]\n`));
            const result = await mcpManager.callTool(toolUse.name, toolUse.input);

            // Log tool observation to amem (passive capture, fire-and-forget)
            const skipLogging = ["memory_log", "memory_recall", "memory_context", "memory_detail", "reminder_check"].includes(toolUse.name);
            if (!skipLogging) {
              mcpManager.callTool("memory_log", {
                session_id: sessionId,
                role: "system",
                content: `[tool:${toolUse.name}] input=${JSON.stringify(toolUse.input).slice(0, 500)} result=${result.slice(0, 500)}`,
              }).catch(() => {});
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

        // Call LLM again with tool results
        response = await withRetry(
          () => client.chat(augmentedSystemPrompt, messages, onChunkHandler, tools),
          { maxAttempts: 3, baseDelay: 1000, retryable: isRetryable },
        );

        // Add assistant response to history
        messages.push(response.message);
      }

      // Memory extraction (runs silently after response)
      if (mcpManager && hooksConfig?.extractMemories) {
        const assistantText = typeof response.message.content === "string"
          ? response.message.content
          : response.message.content
              .filter((b) => b.type === "text")
              .map((b) => ("text" in b ? b.text : ""))
              .join("");

        if (assistantText) {
          const confirmFn = async (content: string): Promise<boolean> => {
            return new Promise<boolean>((resolve) => {
              rl.question(
                pc.dim(`  Remember: "${content}"? (y/N) `),
                (answer) => resolve(answer.toLowerCase() === "y"),
              );
            });
          };

          const count = await runExtraction(
            input, assistantText, client, mcpManager, extractorState, confirmFn,
          );
          if (count > 0) {
            process.stdout.write(pc.dim(`  [${count} memory${count > 1 ? "ies" : ""} stored]\n`));
          }
        }
      } else {
        extractorState.turnsSinceLastExtraction++;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      console.error(pc.red(`\nError: ${message}`));
      // Remove the user message that failed
      messages.pop();
    }
  }
}

// Save conversation messages to amem's memory_log
async function saveConversationToMemory(
  mcpManager: McpManager,
  messages: Message[],
  sessionId: string,
): Promise<void> {
  // Save last 50 messages
  const recentMessages = messages.slice(-50);

  for (const msg of recentMessages) {
    if (typeof msg.content !== "string") continue;
    try {
      await mcpManager.callTool("memory_log", {
        session_id: sessionId,
        role: msg.role,
        content: msg.content.slice(0, 5000),
      });
    } catch (err) {
      log.debug("agent", "memory_log write failed", err);
    }
  }
}
