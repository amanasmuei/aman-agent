import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig } from "./config.js";
import { assembleSystemPrompt } from "./prompt.js";
import { createAnthropicClient } from "./llm/anthropic.js";
import { createOpenAIClient } from "./llm/openai.js";
import { createOllamaClient } from "./llm/ollama.js";
import { McpManager } from "./mcp/client.js";
import { runAgent } from "./agent.js";
import {
  loadSchedules,
  addSchedule,
  removeSchedule,
} from "./scheduler.js";
import {
  checkNotifications,
  displayNotifications,
} from "./notifications.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

declare const __VERSION__: string;

const program = new Command();

program
  .name("aman-agent")
  .description("Your AI companion, running locally")
  .version(__VERSION__)
  .option("--model <model>", "Override LLM model")
  .option("--budget <tokens>", "Token budget for system prompt (default: 8000)", parseInt)
  .action(async (options) => {
    p.intro(pc.bold("aman agent") + pc.dim(" — starting your AI companion"));

    // Setup config if needed
    let config = loadConfig();
    if (!config) {
      p.log.info("First-time setup — configure your LLM connection.");

      const provider = (await p.select({
        message: "LLM provider",
        options: [
          {
            value: "anthropic",
            label: "Claude (Anthropic)",
            hint: "recommended",
          },
          { value: "openai", label: "GPT (OpenAI)" },
          { value: "ollama", label: "Ollama (local)", hint: "free, runs offline" },
        ],
        initialValue: "anthropic",
      })) as "anthropic" | "openai" | "ollama";
      if (p.isCancel(provider)) process.exit(0);

      let apiKey = "";
      let defaultModel = "";

      if (provider === "ollama") {
        apiKey = "ollama";
        const modelInput = (await p.text({
          message: "Ollama model name",
          placeholder: "llama3.2",
          defaultValue: "llama3.2",
        })) as string;
        if (p.isCancel(modelInput)) process.exit(0);
        defaultModel = modelInput || "llama3.2";
      } else if (provider === "anthropic") {
        p.log.info("Get your API key from: https://console.anthropic.com/settings/keys");
        p.log.info(pc.dim("Note: API access is separate from Claude Pro subscription. You need API credits."));

        apiKey = (await p.text({
          message: "API key (starts with sk-ant-)",
          validate: (v) => v.length === 0 ? "API key is required" : undefined,
        })) as string;
        if (p.isCancel(apiKey)) process.exit(0);

        const modelChoice = (await p.select({
          message: "Claude model",
          options: [
            { value: "claude-sonnet-4-5-20250514", label: "Claude Sonnet 4.5", hint: "fast, recommended" },
            { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "most capable" },
            { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fastest, cheapest" },
            { value: "custom", label: "Custom model ID" },
          ],
          initialValue: "claude-sonnet-4-5-20250514",
        })) as string;
        if (p.isCancel(modelChoice)) process.exit(0);

        if (modelChoice === "custom") {
          const customModel = (await p.text({
            message: "Model ID",
            placeholder: "claude-sonnet-4-5-20250514",
            validate: (v) => v.length === 0 ? "Model ID is required" : undefined,
          })) as string;
          if (p.isCancel(customModel)) process.exit(0);
          defaultModel = customModel;
        } else {
          defaultModel = modelChoice;
        }
      } else {
        // OpenAI
        apiKey = (await p.text({
          message: "API key",
          validate: (v) => v.length === 0 ? "API key is required" : undefined,
        })) as string;
        if (p.isCancel(apiKey)) process.exit(0);

        const modelChoice = (await p.select({
          message: "OpenAI model",
          options: [
            { value: "gpt-4o", label: "GPT-4o", hint: "recommended" },
            { value: "gpt-4o-mini", label: "GPT-4o Mini", hint: "faster, cheaper" },
            { value: "o3", label: "o3", hint: "reasoning model" },
            { value: "custom", label: "Custom model ID" },
          ],
          initialValue: "gpt-4o",
        })) as string;
        if (p.isCancel(modelChoice)) process.exit(0);

        if (modelChoice === "custom") {
          const customModel = (await p.text({
            message: "Model ID",
            placeholder: "gpt-4o",
            validate: (v) => v.length === 0 ? "Model ID is required" : undefined,
          })) as string;
          if (p.isCancel(customModel)) process.exit(0);
          defaultModel = customModel;
        } else {
          defaultModel = modelChoice;
        }
      }

      config = { provider, apiKey, model: defaultModel };
      saveConfig(config);
      p.log.success("Config saved to ~/.aman-agent/config.json");
    }

    // Override model if specified
    const model = options.model || config.model;

    // Assemble system prompt from ecosystem with token budget
    const budget = options.budget || undefined;
    const { prompt: systemPrompt, layers, truncated, totalTokens } = assembleSystemPrompt(budget);

    if (layers.length === 0) {
      p.log.warning(
        "No ecosystem configured. Run " +
          pc.bold("npx @aman_asmuei/aman") +
          " first.",
      );
      p.log.info("Starting with empty system prompt.");
    } else {
      p.log.success(
        `Loaded: ${layers.join(", ")} ${pc.dim(`(${totalTokens.toLocaleString()} tokens)`)}`,
      );
      if (truncated.length > 0) {
        p.log.warning(`Truncated: ${truncated.join(", ")} ${pc.dim("(over budget)")}`);
      }
    }

    p.log.info(`Model: ${pc.dim(model)}`);

    // Extract AI name from core.md
    const corePath = path.join(os.homedir(), ".acore", "core.md");
    let aiName = "Assistant";
    if (fs.existsSync(corePath)) {
      const content = fs.readFileSync(corePath, "utf-8");
      const match = content.match(/^# (.+)$/m);
      if (match) aiName = match[1];
    }

    p.log.success(`${pc.bold(aiName)} is ready.`);

    // Session-start notifications
    const notifications = checkNotifications();
    displayNotifications(notifications);

    // Start MCP servers
    const mcpManager = new McpManager();

    p.log.step("Connecting to MCP servers...");

    // Connect to aman-mcp (identity, tools, workflows, rules, eval)
    await mcpManager.connect("aman", "npx", ["-y", "@aman_asmuei/aman-mcp"]);

    // Connect to amem (memory)
    await mcpManager.connect("amem", "npx", ["-y", "@aman_asmuei/amem"]);

    const mcpTools = mcpManager.getTools();
    if (mcpTools.length > 0) {
      p.log.success(`${mcpTools.length} MCP tools available`);
    } else {
      p.log.info(
        "No MCP tools connected (install aman-mcp or amem for tool support)",
      );
    }

    // Convert ToolDef[] to ToolDefinition[] for the LLM
    const toolDefs = mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    // Create LLM client
    let client;
    if (config.provider === "anthropic") {
      client = createAnthropicClient(config.apiKey, model);
    } else if (config.provider === "ollama") {
      client = createOllamaClient(model);
    } else {
      client = createOpenAIClient(config.apiKey, model);
    }

    // Run the agent
    await runAgent(
      client,
      systemPrompt,
      aiName,
      model,
      toolDefs.length > 0 ? toolDefs : undefined,
      toolDefs.length > 0 ? mcpManager : undefined,
    );

    // Cleanup on exit
    await mcpManager.disconnect();
  });

program
  .command("schedule")
  .description("Manage scheduled tasks")
  .argument("[action]", "add, list, or remove")
  .argument("[id]", "task ID (for remove)")
  .action(async (action?: string, id?: string) => {
    if (!action || action === "list") {
      const tasks = loadSchedules();
      if (tasks.length === 0) {
        console.log(pc.dim("No scheduled tasks."));
        return;
      }
      console.log(pc.bold("Scheduled tasks:\n"));
      for (const task of tasks) {
        const lastRun = task.lastRun
          ? pc.dim(` (last run: ${new Date(task.lastRun).toLocaleString()})`)
          : pc.dim(" (never run)");
        console.log(
          `  ${pc.cyan(task.id)}  ${task.name}  ${pc.dim(task.schedule)}  [${task.mode}]${lastRun}`,
        );
      }
      return;
    }

    if (action === "add") {
      const name = (await p.text({
        message: "Task name?",
        validate: (v) => (v.length === 0 ? "Name is required" : undefined),
      })) as string;
      if (p.isCancel(name)) return;

      const schedule = (await p.select({
        message: "Schedule?",
        options: [
          { value: "daily 9am", label: "Daily at 9am" },
          { value: "weekdays 9am", label: "Weekdays at 9am" },
          { value: "weekly friday 4pm", label: "Weekly Friday 4pm" },
          { value: "every 2h", label: "Every 2 hours" },
          { value: "every 4h", label: "Every 4 hours" },
        ],
      })) as string;
      if (p.isCancel(schedule)) return;

      const actionType = (await p.select({
        message: "What should happen?",
        options: [
          { value: "notify", label: "Show notification" },
          { value: "auto-run", label: "Run automatically" },
        ],
      })) as "notify" | "auto-run";
      if (p.isCancel(actionType)) return;

      let taskAction = "notify";
      if (actionType === "auto-run") {
        const cmd = (await p.text({
          message: "Command to run?",
          placeholder: "e.g. run:daily-standup",
          validate: (v) =>
            v.length === 0 ? "Command is required" : undefined,
        })) as string;
        if (p.isCancel(cmd)) return;
        taskAction = cmd;
      }

      const task = addSchedule({
        name,
        schedule,
        action: taskAction,
        mode: actionType,
      });
      console.log(
        pc.green(`\nScheduled task created: ${pc.bold(task.name)} (${task.id})`),
      );
      return;
    }

    if (action === "remove") {
      if (!id) {
        console.log(pc.red("Usage: aman-agent schedule remove <id>"));
        return;
      }
      const removed = removeSchedule(id);
      if (removed) {
        console.log(pc.green(`Task ${id} removed.`));
      } else {
        console.log(pc.red(`Task ${id} not found.`));
      }
      return;
    }

    console.log(
      pc.red(`Unknown action: ${action}. Use add, list, or remove.`),
    );
  });

program.parse();
