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
  formatWellbeingNudge,
  shouldFireNudge,
} from "./personality.js";
import type { HooksConfig } from "./config.js";
import { trimConversation } from "./context-manager.js";
import { log } from "./logger.js";
import { withRetry } from "./retry.js";
import { extractMemories as runExtraction, type ExtractorState } from "./memory-extractor.js";
import { memoryRecall, memoryLog, getMaxRecallTokens } from "./memory.js";
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
  detectTopicShift,
  cleanupOldObservations,
  type ObservationSession,
} from "./observation.js";

// markedTerminal() returns a MarkedExtension — types lag behind, cast is safe
// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.use(markedTerminal() as any);

interface AgentRecallResult {
  text: string;
  tokenEstimate: number;
}

async function recallForMessage(
  input: string,
): Promise<AgentRecallResult | null> {
  try {
    const result = await memoryRecall(input, { limit: 5, compact: true });
    if (result.total === 0) {
      return null;
    }
    const tokenEstimate = result.tokenEstimate ?? Math.round(result.text.split(/\s+/).filter(Boolean).length * 1.3);
    const MAX_MEMORY_TOKENS = getMaxRecallTokens();
    let memoryText = result.text;
    if (tokenEstimate > MAX_MEMORY_TOKENS) {
      // Truncate to fit within the token ceiling (rough char estimate: 1 token ≈ 4 chars)
      const maxChars = MAX_MEMORY_TOKENS * 4;
      memoryText = memoryText.slice(0, maxChars) + "\n[... memory truncated to fit token budget]";
      log.debug("agent", `memory recall truncated from ~${tokenEstimate} to ~${MAX_MEMORY_TOKENS} tokens`);
    }
    return {
      text: `\n\n<relevant-memories>\n${memoryText}\n</relevant-memories>`,
      tokenEstimate: Math.min(tokenEstimate, MAX_MEMORY_TOKENS),
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
  const bgTasks = new BackgroundTaskManager();
  let abortController: AbortController | null = null;
  let isStreaming = false;
  let lastCheckpointTurn = 0;
  const CHECKPOINT_INTERVAL = 10; // auto-save every N user turns

  // Add virtual tools for delegation and teams
  const profiles = listProfiles();
  const teams = listTeams();
  if (tools && (profiles.length > 0 || teams.length > 0)) {
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
        description: `Run a task with a named agent team. Available teams: ${teams.map((t) => `${t.name} (${t.workflow}: ${t.members.map((m) => m.profile).join("→")})`).join(", ")}. IMPORTANT: Always ask the user for permission before running a team.`,
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

    tools = [...tools, ...virtualTools];
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
    {
      const recall = await recallForMessage(input);
      if (recall) {
        augmentedSystemPrompt = activeSystemPrompt + recall.text;
        memoryTokens = recall.tokenEstimate;
      }
    }

    // Personality refresh with sentiment (every 5 turns)
    const userTurnCount = messages.filter((m) => m.role === "user").length;
    if (mcpManager && hooksConfig?.personalityAdapt !== false && userTurnCount > 0 && userTurnCount % 5 === 0) {
      const hour = new Date().getHours();
      let period: string;
      if (hour < 6) period = "late-night";
      else if (hour < 12) period = "morning";
      else if (hour < 17) period = "afternoon";
      else if (hour < 21) period = "evening";
      else period = "night";

      // Collect recent user messages for sentiment analysis
      const recentUserMsgs = messages
        .filter((m) => m.role === "user" && typeof m.content === "string")
        .slice(-5)
        .map((m) => m.content as string);

      const sessionMinutes = Math.round((Date.now() - getSessionStartTime()) / 60000);
      const state = computePersonality({
        timePeriod: period,
        sessionMinutes,
        turnCount: userTurnCount,
        recentMessages: recentUserMsgs,
      });

      syncPersonalityToCore(state, mcpManager).catch(() => {});

      // Record sentiment shift observation
      if (observationSession && prevSentiment !== state.sentiment.dominant) {
        recordEvent(observationSession, {
          type: "sentiment_shift",
          summary: `${prevSentiment ?? "neutral"} → ${state.sentiment.dominant}`,
          data: { from: prevSentiment ?? "neutral", to: state.sentiment.dominant },
        });
        prevSentiment = state.sentiment.dominant;
      }

      // Record blocker observation on sustained frustration
      if (observationSession && state.sentiment.frustration > 0.6) {
        recordEvent(observationSession, {
          type: "blocker",
          summary: "User expressing frustration",
          data: { frustrationLevel: state.sentiment.frustration },
        });
      }

      // Detect topic shift based on recent vs prior user messages
      if (observationSession && recentUserMsgs.length >= 6) {
        const recent = recentUserMsgs.slice(-3);
        const previous = recentUserMsgs.slice(-6, -3);
        const shift = detectTopicShift(recent, previous);
        if (shift.shifted) {
          recordEvent(observationSession, {
            type: "topic_shift",
            summary: `Topics: ${shift.newTopics.join(", ")}`,
            data: { newTopics: shift.newTopics },
          });
        }
      }

      const nudge = formatWellbeingNudge(state);
      if (nudge && state.wellbeingNudge) {
        // Adaptive nudge: check user model stats before firing
        let fireNudge = true;
        try {
          const { loadUserModel, computeProfile } = await import("./user-model.js");
          const model = await loadUserModel();
          if (model && model.sessions.length >= 5) {
            const profile = computeProfile(model.sessions, model.sessions.length);
            fireNudge = shouldFireNudge(state.wellbeingNudge, profile);
          }
        } catch {
          // No model yet — always fire
        }
        if (fireNudge) {
          augmentedSystemPrompt += "\n" + nudge;
        }
      }

      // Feed-forward v2: preemptive context from frustration correlations
      try {
        const { loadUserModel, computeProfile } = await import("./user-model.js");
        const model = await loadUserModel();
        if (model && model.sessions.length >= 10) {
          const profile = computeProfile(model.sessions, model.sessions.length);
          const preemptive: string[] = [];

          // Late night + high correlation → extra gentle mode
          const hour = new Date().getHours();
          const isLate = hour >= 21 || hour < 6;
          if (isLate && profile.frustrationCorrelations.lateNight > 0.4) {
            preemptive.push(
              "Based on past patterns, late-night sessions tend to increase frustration for this user. " +
              "Be extra concise, proactive about blockers, and gently suggest wrapping up if frustration rises."
            );
          }

          // Long session + high correlation → preemptive break suggestion
          const sessionMins = Math.round((Date.now() - getSessionStartTime()) / 60000);
          if (sessionMins > 60 && profile.frustrationCorrelations.longSessions > 0.4) {
            preemptive.push(
              "This session is getting long and past patterns show long sessions correlate with frustration. " +
              "Proactively suggest natural breakpoints."
            );
          }

          if (preemptive.length > 0) {
            augmentedSystemPrompt += `\n<feed-forward-v2>\n${preemptive.join("\n")}\n</feed-forward-v2>`;
          }
        }
      } catch {
        // No model — skip feed-forward v2
      }

      // Burnout predictor
      try {
        const { loadUserModel, predictBurnout } = await import("./user-model.js");
        const model = await loadUserModel();
        if (model && model.sessions.length >= 5) {
          const sessionMins = Math.round((Date.now() - getSessionStartTime()) / 60000);
          const burnout = predictBurnout(model.sessions, {
            minutes: sessionMins,
            frustration: state.sentiment.frustration,
            timePeriod: period,
          });
          if (burnout.risk > 0.7) {
            const burnoutState = { ...state, wellbeingNudge: "burnout-warning" };
            const burnoutNudge = formatWellbeingNudge(burnoutState);
            if (burnoutNudge) {
              augmentedSystemPrompt += "\n" + burnoutNudge;
            }
          }
        }
      } catch {
        // No model — skip
      }
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
        if (responseBuffer.trim()) {
          messages.push({ role: "assistant", content: responseBuffer.trim() });
          if (process.stdout.isTTY) {
            try { logUpdate(marked(responseBuffer.trim()) as string); logUpdate.done(); } catch { logUpdate.done(); }
          }
          responseBuffer = "";
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

// Save conversation messages to memory log
async function saveConversationToMemory(
  messages: Message[],
  sessionId: string,
): Promise<void> {
  // Save last 50 messages
  const recentMessages = messages.slice(-50);

  for (const msg of recentMessages) {
    if (typeof msg.content !== "string") continue;
    try {
      memoryLog(sessionId, msg.role, msg.content.slice(0, 5000));
    } catch (err) {
      log.debug("agent", "memory_log write failed", err);
    }
  }
}
