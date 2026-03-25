import * as readline from "node:readline";
import pc from "picocolors";
import type {
  LLMClient,
  Message,
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
      } catch { /* Skip */ }
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
    } catch { /* Hook failure — continue */ }
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
          } catch { /* Skip */ }
        }
        console.log(pc.dim("\nGoodbye.\n"));
        rl.close();
        return;
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
      } catch { /* Skip */ }
    }

    // Auto-trim conversation if approaching token limits
    trimConversation(messages, client);

    // Send to LLM
    messages.push({ role: "user", content: input });

    process.stdout.write(pc.cyan(`\n${aiName} > `));

    try {
      let response = await client.chat(
        activeSystemPrompt,
        messages,
        (chunk) => {
          if (chunk.type === "text" && chunk.text) {
            process.stdout.write(chunk.text);
          }
          if (chunk.type === "done") {
            process.stdout.write("\n");
          }
        },
        tools,
      );

      // Add assistant message to history
      messages.push(response.message);

      // Agentic tool loop: execute tools until LLM stops requesting them
      while (response.toolUses.length > 0 && mcpManager) {
        const toolResults: ToolResultBlock[] = [];

        for (const toolUse of response.toolUses) {
          if (hooksConfig) {
            const hookCtx: HookContext = { mcpManager: mcpManager!, config: hooksConfig };
            const check = await onBeforeToolExec(toolUse.name, toolUse.input, hookCtx);
            if (!check.allow) {
              process.stdout.write(pc.red(`  [BLOCKED: ${check.reason}]\n`));
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `BLOCKED by guardrail: ${check.reason}`,
                is_error: true,
              });
              continue;
            }
          }

          process.stdout.write(
            pc.dim(`  [using ${toolUse.name}...]\n`),
          );
          const result = await mcpManager.callTool(
            toolUse.name,
            toolUse.input,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        }

        // Add tool results as a user message
        messages.push({
          role: "user",
          content: toolResults,
        });

        // Call LLM again with tool results
        response = await client.chat(
          activeSystemPrompt,
          messages,
          (chunk) => {
            if (chunk.type === "text" && chunk.text) {
              process.stdout.write(chunk.text);
            }
            if (chunk.type === "done") {
              process.stdout.write("\n");
            }
          },
          tools,
        );

        // Add assistant response to history
        messages.push(response.message);
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
    } catch {
      // Skip individual failures
    }
  }
}
