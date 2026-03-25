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
      config.hooks,
    );

    // Cleanup on exit
    await mcpManager.disconnect();
  });

program.parse();
