import * as readline from "node:readline";
import pc from "picocolors";
import type {
  LLMClient,
  Message,
  ToolDefinition,
  ToolResultBlock,
} from "./llm/types.js";
import { handleCommand } from "./commands.js";
import { setReminder, clearReminders } from "./reminders.js";
import type { McpManager } from "./mcp/client.js";

export async function runAgent(
  client: LLMClient,
  systemPrompt: string,
  aiName: string,
  model: string,
  tools?: ToolDefinition[],
  mcpManager?: McpManager,
): Promise<void> {
  const messages: Message[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle Ctrl+C gracefully
  rl.on("SIGINT", () => {
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

  while (true) {
    const input = await prompt();
    if (!input.trim()) continue;

    // Handle slash commands
    const cmdResult = handleCommand(input, model);
    if (cmdResult.handled) {
      if (cmdResult.quit) {
        clearReminders();
        console.log(pc.dim("\nGoodbye.\n"));
        rl.close();
        return;
      }
      if (cmdResult.remind) {
        const duration = setReminder(
          cmdResult.remind.timeStr,
          cmdResult.remind.message,
        );
        if (duration) {
          console.log(pc.dim(`Reminder set for ${duration} from now.`));
        } else {
          console.log(
            pc.red("Invalid time format. Use: 5m, 30m, 1h, 2h, tomorrow"),
          );
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

    // Send to LLM
    messages.push({ role: "user", content: input });

    process.stdout.write(pc.cyan(`\n${aiName} > `));

    try {
      let response = await client.chat(
        systemPrompt,
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
          systemPrompt,
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
