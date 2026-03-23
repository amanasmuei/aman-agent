import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig } from "./config.js";
import { assembleSystemPrompt } from "./prompt.js";
import { createAnthropicClient } from "./llm/anthropic.js";
import { createOpenAIClient } from "./llm/openai.js";
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
        ],
        initialValue: "anthropic",
      })) as "anthropic" | "openai";
      if (p.isCancel(provider)) process.exit(0);

      const apiKey = (await p.text({
        message: "API key",
        validate: (v) =>
          v.length === 0 ? "API key is required" : undefined,
      })) as string;
      if (p.isCancel(apiKey)) process.exit(0);

      const defaultModel =
        provider === "anthropic" ? "claude-sonnet-4-5-20250514" : "gpt-4o";

      config = { provider, apiKey, model: defaultModel };
      saveConfig(config);
      p.log.success("Config saved to ~/.aman-agent/config.json");
    }

    // Override model if specified
    const model = options.model || config.model;

    // Assemble system prompt from ecosystem
    const { prompt: systemPrompt, layers } = assembleSystemPrompt();

    if (layers.length === 0) {
      p.log.warning(
        "No ecosystem configured. Run " +
          pc.bold("npx @aman_asmuei/aman") +
          " first.",
      );
      p.log.info("Starting with empty system prompt.");
    } else {
      p.log.success(`Loaded: ${layers.join(", ")}`);
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

    // Create LLM client
    const client =
      config.provider === "anthropic"
        ? createAnthropicClient(config.apiKey, model)
        : createOpenAIClient(config.apiKey, model);

    // Run the agent
    await runAgent(client, systemPrompt, aiName, model);
  });

program.parse();
