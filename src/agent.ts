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
  ImageBlock,
  StreamChunk,
} from "./llm/types.js";
import { handleCommand } from "./commands.js";
import type { McpManager } from "./mcp/client.js";
import {
  onSessionStart,
  onBeforeToolExec,
  onWorkflowMatch,
  onSessionEnd,
  getSessionStartTime,
  type HookContext,
} from "./hooks.js";
import {
  computePersonality,
  syncPersonalityToCore,
  formatSleepNudge,
} from "./personality.js";
import type { HooksConfig } from "./config.js";
import { trimConversation } from "./context-manager.js";
import { log } from "./logger.js";
import { withRetry } from "./retry.js";
import { extractMemories as runExtraction, type ExtractorState } from "./memory-extractor.js";
import { humanizeError } from "./errors.js";
import { getHint, loadShownHints, saveShownHints, type HintState } from "./hints.js";

// markedTerminal() returns a MarkedExtension — types lag behind, cast is safe
// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.use(markedTerminal() as any);

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
    err.message.includes("fetch failed");

  let responseBuffer = "";

  const onChunkHandler = (chunk: StreamChunk) => {
    if (chunk.type === "text" && chunk.text) {
      responseBuffer += chunk.text;
      if (process.stdout.isTTY) {
        logUpdate(responseBuffer);
      } else {
        process.stdout.write(chunk.text);
      }
    }
    if (chunk.type === "done") {
      if (process.stdout.isTTY && responseBuffer.trim()) {
        try {
          const rendered = marked(responseBuffer.trim()) as string;
          logUpdate(rendered);
          logUpdate.done();
        } catch {
          logUpdate.done();
        }
      } else {
        process.stdout.write("\n");
      }
      responseBuffer = "";
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

    // Detect and process file paths + image URLs in user input
    const textExts = new Set([
      ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".py",
      ".html", ".css", ".yml", ".yaml", ".toml", ".xml", ".csv",
      ".sh", ".bash", ".zsh", ".env", ".cfg", ".ini", ".log",
      ".sql", ".graphql", ".rs", ".go", ".java", ".rb", ".php",
      ".c", ".cpp", ".h", ".swift", ".kt", ".r", ".lua",
    ]);
    const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
    const docExts = new Set([".docx", ".doc", ".pdf", ".pptx", ".ppt", ".xlsx", ".xls", ".odt", ".rtf", ".epub"]);
    const mimeMap: Record<string, ImageBlock["source"]["media_type"]> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/png",
    };
    const maxImageBytes = 20 * 1024 * 1024; // 20MB

    let textContent = input;
    const imageBlocks: ImageBlock[] = [];

    // Detect all local file paths
    const filePathMatches = [...input.matchAll(/(\/[\w./-]+|~\/[\w./-]+)/g)];
    for (const match of filePathMatches) {
      let filePath = match[1];
      if (filePath.startsWith("~/")) {
        filePath = path.join(os.homedir(), filePath.slice(2));
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;

      const ext = path.extname(filePath).toLowerCase();

      if (imageExts.has(ext)) {
        // Image file — base64 encode
        try {
          const stat = fs.statSync(filePath);
          if (stat.size > maxImageBytes) {
            process.stdout.write(pc.yellow(`  [skipped: ${path.basename(filePath)} — exceeds 20MB limit]\n`));
            continue;
          }
          const data = fs.readFileSync(filePath).toString("base64");
          const mediaType = mimeMap[ext] || "image/png";
          imageBlocks.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data },
          });
          process.stdout.write(pc.dim(`  [attached image: ${path.basename(filePath)} (${(stat.size / 1024).toFixed(1)}KB)]\n`));
        } catch {
          process.stdout.write(pc.dim(`  [could not read image: ${filePath}]\n`));
        }
      } else if (textExts.has(ext) || ext === "") {
        // Text file — inline as XML
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const maxChars = 50000;
          const trimmed = content.length > maxChars
            ? content.slice(0, maxChars) + `\n\n[... truncated, ${content.length - maxChars} chars remaining]`
            : content;
          textContent += `\n\n<file path="${filePath}" size="${content.length} chars">\n${trimmed}\n</file>`;
          process.stdout.write(pc.dim(`  [attached: ${path.basename(filePath)} (${(content.length / 1024).toFixed(1)}KB)]\n`));
        } catch {
          process.stdout.write(pc.dim(`  [could not read: ${filePath}]\n`));
        }
      } else if (docExts.has(ext)) {
        // Binary document — convert via MCP
        if (mcpManager) {
          try {
            process.stdout.write(pc.dim(`  [converting: ${path.basename(filePath)}...]\n`));
            const converted = await mcpManager.callTool("doc_convert", { path: filePath });
            if (converted && !converted.startsWith("Error") && !converted.includes("Could not convert")) {
              textContent += `\n\n<file path="${filePath}" format="${ext}">\n${converted.slice(0, 50000)}\n</file>`;
              process.stdout.write(pc.dim(`  [attached: ${path.basename(filePath)} (converted from ${ext})]\n`));
            } else {
              textContent += `\n\n<file-error path="${filePath}">\n${converted}\n</file-error>`;
              process.stdout.write(pc.yellow(`  [conversion note: ${converted.split("\n")[0]}]\n`));
            }
          } catch {
            process.stdout.write(pc.dim(`  [could not convert: ${path.basename(filePath)}]\n`));
          }
        } else {
          process.stdout.write(pc.yellow(`  Binary file (${ext}) — install Docling for document support: pip install docling\n`));
        }
      }
    }

    // Detect image URLs in user input
    const urlImageMatches = [...input.matchAll(/https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S*)?/gi)];
    for (const match of urlImageMatches) {
      const url = match[0];
      try {
        process.stdout.write(pc.dim(`  [fetching image: ${url.slice(0, 60)}...]\n`));
        const response = await fetch(url);
        if (!response.ok) {
          process.stdout.write(pc.yellow(`  [could not fetch: HTTP ${response.status}]\n`));
          continue;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxImageBytes) {
          process.stdout.write(pc.yellow(`  [skipped: image URL exceeds 20MB limit]\n`));
          continue;
        }
        const contentType = response.headers.get("content-type") || "";
        let mediaType: ImageBlock["source"]["media_type"] = "image/png";
        if (contentType.includes("jpeg") || contentType.includes("jpg")) mediaType = "image/jpeg";
        else if (contentType.includes("gif")) mediaType = "image/gif";
        else if (contentType.includes("webp")) mediaType = "image/webp";
        else if (contentType.includes("png")) mediaType = "image/png";

        imageBlocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
        });
        process.stdout.write(pc.dim(`  [attached image URL: (${(buffer.length / 1024).toFixed(1)}KB)]\n`));
      } catch {
        process.stdout.write(pc.dim(`  [could not fetch image: ${url}]\n`));
      }
    }

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
    if (mcpManager) {
      const recall = await recallForMessage(input, mcpManager);
      if (recall) {
        augmentedSystemPrompt = activeSystemPrompt + recall.text;
        memoryTokens = recall.tokenEstimate;
      }
    }

    // Periodic personality refresh (every 10 turns)
    const userTurnCount = messages.filter((m) => m.role === "user").length;
    if (mcpManager && hooksConfig?.personalityAdapt !== false && userTurnCount > 0 && userTurnCount % 10 === 0) {
      const hour = new Date().getHours();
      let period: string;
      if (hour < 6) period = "late-night";
      else if (hour < 12) period = "morning";
      else if (hour < 17) period = "afternoon";
      else if (hour < 21) period = "evening";
      else period = "night";

      const sessionMinutes = Math.round((Date.now() - getSessionStartTime()) / 60000);
      const state = computePersonality({
        timePeriod: period,
        sessionMinutes,
        turnCount: userTurnCount,
      });

      syncPersonalityToCore(state, mcpManager).catch(() => {});

      if (state.sleepReminder) {
        augmentedSystemPrompt += "\n" + formatSleepNudge();
      }
    }

    const divider = "─".repeat(Math.min(process.stdout.columns || 60, 60) - aiName.length - 2);
    process.stdout.write(`\n ${pc.cyan(pc.bold(aiName))} ${pc.dim(divider)}\n\n`);

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

      // Response footer
      const footerParts: string[] = [];
      if (memoryTokens > 0) footerParts.push(`memories: ~${memoryTokens} tokens`);
      const footer = footerParts.length > 0 ? ` ${footerParts.join(" | ")}` : "";
      const footerDivider = "─".repeat(Math.min(process.stdout.columns || 60, 60) - footer.length - 1);
      process.stdout.write(pc.dim(` ${footerDivider}${footer}\n`));

      // Memory extraction (runs silently after response)
      if (mcpManager && hooksConfig?.extractMemories) {
        const assistantText = typeof response.message.content === "string"
          ? response.message.content
          : response.message.content
              .filter((b) => b.type === "text")
              .map((b) => ("text" in b ? b.text : ""))
              .join("");

        if (assistantText) {
          const count = await runExtraction(
            input, assistantText, client, mcpManager, extractorState,
          );
          if (count > 0) {
            process.stdout.write(pc.dim(`  [${count} memory${count > 1 ? "ies" : ""} stored]\n`));
          }
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
      const rawMessage = error instanceof Error ? error.message : "Unknown error occurred";
      const friendly = humanizeError(rawMessage);
      console.error(pc.red(`\n  ${friendly}`));
      // Don't remove the user message — keep for retry
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
