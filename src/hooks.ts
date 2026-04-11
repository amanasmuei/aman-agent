import pc from "picocolors";
import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { McpManager } from "./mcp/client.js";
import type { LLMClient, Message } from "./llm/types.js";
import type { HooksConfig } from "./config.js";
import { log } from "./logger.js";
import {
  computePersonality,
  syncPersonalityToCore,
  formatWellbeingNudge,
  shouldFireNudge,
} from "./personality.js";
import { memoryRecall, memoryContext, reminderCheck, memoryLog, isMemoryInitialized, memoryStore } from "./memory.js";
import { loadUserIdentity } from "./user-identity.js";
import { shouldAutoPostmortem, generatePostmortemReport, savePostmortem } from "./postmortem.js";
import {
  validateCandidate,
  writeSkillToFile,
  mergeSkillInFile,
  appendCrystallizationLog,
  appendRejection,
  loadRejectedNames,
  incrementSuggestionCount,
  loadSuggestionCounts,
} from "./crystallization.js";
import type { ObservationSession } from "./observation.js";
import {
  loadUserModel,
  saveUserModel,
  createEmptyModel,
  aggregateSession,
  computeProfile,
  feedForward,
  type SessionSnapshot,
  type PersonalityOverrides,
} from "./user-model.js";

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
  llmClient?: LLMClient; // needed for auto-postmortem generation
}

let isHookCall = false;
let sessionStartTime: number = Date.now();

export function getSessionStartTime(): number {
  return sessionStartTime;
}

export async function onSessionStart(
  ctx: HookContext,
): Promise<{ greeting?: string; contextInjection?: string; firstRun?: boolean; visibleReminders?: string[]; resumeTopic?: string }> {
  let greeting = "";
  let contextInjection = "";
  let firstRun = false;
  let resumeTopic: string | undefined;
  const visibleReminders: string[] = [];

  // Detect first run via memory_recall
  if (!isMemoryInitialized()) {
    // Memory system failed to init — skip memory operations but don't treat as first run
    firstRun = false;
  } else {
    try {
      isHookCall = true;
      const recallResult = await memoryRecall("*", { limit: 1 });
      firstRun = recallResult.total === 0;
    } catch {
      firstRun = true;
    } finally {
      isHookCall = false;
    }
  }

  if (firstRun) {
    const userIdentity = loadUserIdentity();

    if (userIdentity) {
      // First run WITH user profile — personalized introduction
      contextInjection = `<first-session>
This is your FIRST conversation with ${userIdentity.name}. They just set up their profile:
- Role: ${userIdentity.roleLabel}
- Expertise: ${userIdentity.expertiseLabel}
- Style preference: ${userIdentity.styleLabel}
${userIdentity.workingOn ? `- Working on: ${userIdentity.workingOn}` : ""}
${userIdentity.notes ? `- Notes: ${userIdentity.notes}` : ""}

Introduce yourself warmly:
- Greet them by name
- Acknowledge what they do and what they're working on (if provided)
- Show you understand their style preference (e.g., if they want concise answers, keep it tight)
- Mention you'll remember what matters across conversations
- Keep it to 3-5 sentences, natural tone — make them feel like you GET them
</first-session>`;
    } else {
      // First run WITHOUT user profile — generic introduction
      contextInjection = `<first-session>
This is your FIRST conversation with this user. Introduce yourself warmly:
- Share your name and that you're their personal AI companion
- Mention you'll remember what matters across conversations
- Ask what they'd like to be called
- Mention they can set up their profile with /profile edit for a more personalized experience
- Keep it to 3-4 sentences, natural tone
</first-session>`;
    }

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
      const contextResult = await memoryContext("session context");
      if (contextResult.memoriesUsed > 0) {
        greeting += contextResult.text;
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
    const reminders = reminderCheck();
    if (reminders.length > 0) {
      const reminderText = reminders.map(r => r.content).join("\n");
      greeting += "\n\n<pending-reminders>\n" + reminderText + "\n</pending-reminders>";
      for (const r of reminders) {
        visibleReminders.push(r.content);
      }
    }
  } catch (err) {
    log.debug("hooks", "reminder_check failed", err);
  } finally {
    isHookCall = false;
  }

  // Compute initial personality state (with feed-forward from user model)
  if (ctx.config.personalityAdapt !== false) {
    sessionStartTime = Date.now();
    const hour = new Date().getHours();
    let period: string;
    if (hour < 6) period = "late-night";
    else if (hour < 12) period = "morning";
    else if (hour < 17) period = "afternoon";
    else if (hour < 21) period = "evening";
    else period = "night";

    const state = computePersonality({
      timePeriod: period,
      sessionMinutes: 0,
      turnCount: 0,
    });

    // Load user model for feed-forward overrides
    try {
      const model = await loadUserModel();
      if (model) {
        const overrides = feedForward(model);
        if (overrides) {
          log.debug("hooks", `Feed-forward active (trust=${model.profile.trustScore.toFixed(2)}, sessions=${model.profile.totalSessions})`);

          // Apply energy override (e.g., night owls stay "steady" instead of "reflective")
          if (overrides.energyOverride && (period === "late-night" || period === "night")) {
            (state as { energy: string }).energy = overrides.energyOverride as typeof state.energy;
          }

          // Apply default-to-Personal-mode when sentiment is worsening
          if (overrides.defaultToPersonalMode && state.activeMode === "Default") {
            (state as { activeMode: string }).activeMode = "Personal";
          }

          // Inject trust context into greeting
          if (overrides.compactGreeting) {
            greeting += "\n<user-model-context>High trust user (score: " +
              model.profile.trustScore.toFixed(2) +
              ", " + model.profile.totalSessions +
              " sessions). Keep greeting compact — they know you well.</user-model-context>";
          }

          // Surface sentiment trend if concerning
          if (model.profile.sentimentTrend === "worsening") {
            greeting += "\n<user-model-context>Sentiment trend is worsening across recent sessions. Be more attentive and patient.</user-model-context>";
          }
        }
      }
    } catch (err) {
      log.debug("hooks", "user model feed-forward failed", err);
    }

    // Sync to acore (fire-and-forget)
    syncPersonalityToCore(state, ctx.mcpManager).catch(() => {});

    // Add wellbeing nudge to context if applicable (with adaptive filtering)
    const nudge = formatWellbeingNudge(state);
    if (nudge && state.wellbeingNudge) {
      let fireNudge = true;
      try {
        const model = await loadUserModel();
        if (model && model.sessions.length >= 5) {
          const profile = computeProfile(model.sessions, model.sessions.length);
          fireNudge = shouldFireNudge(state.wellbeingNudge, profile);
        }
      } catch {
        // No model yet — always fire
      }
      if (fireNudge) {
        greeting += "\n" + nudge;
      }
    }
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
  observationSession?: ObservationSession,
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
          memoryLog(sessionId, msg.role, (msg.content as string).slice(0, 5000));
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

    // Update per-project .acore/context.md if it exists
    const projectContextPath = path.join(process.cwd(), ".acore", "context.md");
    if (fs.existsSync(projectContextPath) && messages.length > 2) {
      try {
        let contextContent = fs.readFileSync(projectContextPath, "utf-8");
        const now = new Date().toISOString().split("T")[0];

        // Extract last user message for resume
        let lastUserMsg = "";
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "user" && typeof messages[i].content === "string") {
            lastUserMsg = (messages[i].content as string).slice(0, 200);
            break;
          }
        }

        // Update Session section in context.md
        const sessionPattern = /## Session\n[\s\S]*?(?=\n## |$)/;
        if (sessionPattern.test(contextContent)) {
          const newSession = `## Session\n- Last updated: ${now}\n- Resume: ${lastUserMsg || "See conversation history"}\n- Active topics: [see memory]\n- Recent decisions: [see memory]\n- Temp notes: [cleared]`;
          contextContent = contextContent.replace(sessionPattern, newSession);
          fs.writeFileSync(projectContextPath, contextContent, "utf-8");
          log.debug("hooks", `Updated project context: ${projectContextPath}`);
        }
      } catch (err) {
        log.debug("hooks", "project context update failed", err);
      }
    }

    // Persist final personality state
    const sessionMinutes = Math.round((Date.now() - sessionStartTime) / 60000);
    const hour = new Date().getHours();
    let period: string;
    if (hour < 6) period = "late-night";
    else if (hour < 12) period = "morning";
    else if (hour < 17) period = "afternoon";
    else if (hour < 21) period = "evening";
    else period = "night";

    const turnCount = messages.filter((m) => m.role === "user").length;
    const finalState = computePersonality({
      timePeriod: period,
      sessionMinutes,
      turnCount,
    });

    if (ctx.config.personalityAdapt !== false) {
      try {
        isHookCall = true;
        await syncPersonalityToCore(finalState, ctx.mcpManager);
      } finally {
        isHookCall = false;
      }
    }

    // Session rating prompt
    let sessionRating: string | undefined;
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
        sessionRating = rating as string;
        try {
          isHookCall = true;
          await ctx.mcpManager.callTool("eval_log", {
            rating: sessionRating,
            highlights: "Quick session rating",
            improvements: "",
          });
        } finally {
          isHookCall = false;
        }
      }
    }

    // Aggregate session into user model (v0.27)
    if (turnCount >= 2 && sessionMinutes >= 1) {
      try {
        const snapshot: SessionSnapshot = {
          sessionId,
          date: new Date().toISOString().split("T")[0],
          durationMinutes: sessionMinutes,
          turnCount,
          dominantSentiment: finalState.sentiment.dominant,
          avgFrustration: finalState.sentiment.frustration,
          avgExcitement: finalState.sentiment.excitement,
          avgConfusion: finalState.sentiment.confusion,
          avgFatigue: finalState.sentiment.fatigue,
          toolCalls: observationSession?.stats.toolCalls ?? 0,
          toolErrors: observationSession?.stats.toolErrors ?? 0,
          blockers: observationSession?.stats.blockers ?? 0,
          milestones: observationSession?.stats.milestones ?? 0,
          topicShifts: observationSession?.stats.topicShifts ?? 0,
          peakEnergy: finalState.energy,
          primaryMode: finalState.activeMode,
          timePeriod: period,
          rating: sessionRating,
          hadPostmortem: false, // updated below if postmortem is generated
          wellbeingNudges: finalState.wellbeingNudge ? [finalState.wellbeingNudge] : [],
        };

        const model = (await loadUserModel()) ?? createEmptyModel();
        const updated = aggregateSession(model, snapshot);
        await saveUserModel(updated);
        log.debug("hooks", `User model updated (session ${updated.profile.totalSessions})`);

        // Sync model metrics to acore dynamics section
        if (ctx.config.personalityAdapt !== false) {
          try {
            isHookCall = true;
            await syncPersonalityToCore(finalState, ctx.mcpManager, {
              trustScore: updated.profile.trustScore,
              totalSessions: updated.profile.totalSessions,
              sentimentTrend: updated.profile.sentimentTrend,
            });
          } finally {
            isHookCall = false;
          }
        }
      } catch (err) {
        log.debug("hooks", "user model aggregation failed", err);
      }
    }

    // Auto post-mortem (smart trigger)
    if (
      ctx.config.autoPostmortem !== false &&
      observationSession &&
      shouldAutoPostmortem(observationSession, messages)
    ) {
      try {
        const client = ctx.llmClient;
        if (client) {
          // Load rejected skill names for feedback loop
          const rejectionsPath = path.join(
            os.homedir(),
            ".aman-agent",
            "crystallization-rejections.json",
          );
          const rejectedNames = await loadRejectedNames(rejectionsPath);

          const report = await generatePostmortemReport(
            sessionId,
            messages,
            observationSession,
            client,
            undefined,
            rejectedNames,
          );
          if (report) {
            const filePath = await savePostmortem(report);
            console.log(pc.dim(`\n  Post-mortem saved → ${filePath}`));

            // Store actionable patterns as memories
            for (const pattern of report.patterns) {
              try {
                await memoryStore({
                  content: pattern,
                  type: "pattern",
                  tags: ["postmortem", "auto"],
                  confidence: 0.7,
                });
              } catch {
                // Silent — don't block exit
              }
            }

            // Crystallization prompt loop (v0.26 + v0.28 reinforcement)
            if (
              report.crystallizationCandidates &&
              report.crystallizationCandidates.length > 0
            ) {
              const skillsMdPath = path.join(os.homedir(), ".askill", "skills.md");
              const logPath = path.join(
                os.homedir(),
                ".aman-agent",
                "crystallization-log.json",
              );
              const rejectionsPath2 = path.join(
                os.homedir(),
                ".aman-agent",
                "crystallization-rejections.json",
              );
              const suggestionsPath = path.join(
                os.homedir(),
                ".aman-agent",
                "crystallization-suggestions.json",
              );
              const postmortemFilename = `${report.date}-${report.sessionId.slice(0, 4)}.md`;

              console.log(
                pc.dim(`\n  Crystallization candidates: ${report.crystallizationCandidates.length}`),
              );

              let skipAll = false;
              for (const rawCandidate of report.crystallizationCandidates) {
                if (skipAll) break;
                const candidate = validateCandidate(rawCandidate);
                if (!candidate) {
                  log.debug("hooks", "candidate failed validation");
                  continue;
                }

                // Track suggestion count for reinforcement
                const suggestCount = await incrementSuggestionCount(candidate.name, suggestionsPath);
                const reinforced = suggestCount >= 3;

                const message = reinforced
                  ? `Crystallize "${candidate.name}"? (suggested ${suggestCount}× across sessions — high confidence)`
                  : `Crystallize "${candidate.name}" as a reusable skill?`;

                const choice = await p.select({
                  message,
                  options: [
                    { value: "accept", label: reinforced ? "Yes — recommended (seen multiple times)" : "Yes — write to ~/.askill/skills.md" },
                    { value: "reject", label: "No — skip this one" },
                    { value: "skip-all", label: "Skip all crystallization for this session" },
                  ],
                  initialValue: reinforced ? "accept" : "reject",
                });

                if (p.isCancel(choice) || choice === "skip-all") {
                  skipAll = true;
                  break;
                }

                if (choice === "accept") {
                  const result = await writeSkillToFile(
                    candidate,
                    skillsMdPath,
                    postmortemFilename,
                  );
                  if (result.written) {
                    console.log(
                      pc.green(`  ✓ Crystallized: ${candidate.name} → ${result.filePath}`),
                    );
                    console.log(pc.dim(`    Triggers: ${candidate.triggers.join(", ")}`));
                    console.log(pc.dim(`    Will auto-activate next session.`));
                    await appendCrystallizationLog(
                      {
                        name: candidate.name,
                        createdAt: new Date().toISOString(),
                        fromPostmortem: postmortemFilename,
                        confidence: candidate.confidence,
                        triggers: candidate.triggers,
                      },
                      logPath,
                    );
                  } else if (result.collidesWith) {
                    // Collision detected — offer merge
                    const mergeChoice = await p.select({
                      message: `"${candidate.name}" collides with existing "${result.collidesWith}". Merge?`,
                      options: [
                        { value: "merge", label: `Yes — replace "${result.collidesWith}" with updated version` },
                        { value: "skip", label: "No — keep existing" },
                      ],
                      initialValue: "merge",
                    });

                    if (!p.isCancel(mergeChoice) && mergeChoice === "merge") {
                      const mergeResult = await mergeSkillInFile(
                        candidate,
                        result.collidesWith,
                        skillsMdPath,
                        postmortemFilename,
                      );
                      if (mergeResult.written) {
                        console.log(pc.green(`  ✓ Merged: ${candidate.name} (replaced "${result.collidesWith}")`));
                        await appendCrystallizationLog(
                          {
                            name: candidate.name,
                            createdAt: new Date().toISOString(),
                            fromPostmortem: postmortemFilename,
                            confidence: candidate.confidence,
                            triggers: candidate.triggers,
                          },
                          logPath,
                        );
                      } else {
                        console.log(pc.yellow(`  ⊘ Merge failed: ${mergeResult.reason}`));
                      }
                    } else {
                      console.log(pc.dim(`  Kept existing: ${result.collidesWith}`));
                    }
                  } else {
                    console.log(pc.yellow(`  ⊘ Could not crystallize: ${result.reason}`));
                  }
                } else {
                  console.log(pc.dim(`  Skipped: ${candidate.name}`));
                  await appendRejection(candidate, postmortemFilename, rejectionsPath2);
                }
              }
            }
          }
        }
      } catch (err) {
        log.debug("hooks", "auto post-mortem failed", err);
      }
    }
  } catch (err) {
    log.warn("hooks", "session end hook failed", err);
  }
}
