import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig } from "./config.js";
import { assembleSystemPrompt, getProfileAiName } from "./prompt.js";
import { createAnthropicClient } from "./llm/anthropic.js";
import { createOpenAIClient } from "./llm/openai.js";
import { createOllamaClient } from "./llm/ollama.js";
import { McpManager } from "./mcp/client.js";
import { runAgent } from "./agent.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyPreset, PRESETS, type PresetName } from "./presets.js";
import { initMemory, memoryConsolidate, isMemoryInitialized } from "./memory.js";

declare const __VERSION__: string;

interface AutoDetectedConfig {
  provider: "anthropic" | "openai" | "ollama";
  apiKey: string;
  model: string;
}

async function autoDetectConfig(): Promise<AutoDetectedConfig | null> {
  // Skip auto-detect if user just ran /reset config
  const reconfigMarker = path.join(os.homedir(), ".aman-agent", ".reconfig");
  if (fs.existsSync(reconfigMarker)) {
    fs.unlinkSync(reconfigMarker);
    return null; // Force interactive prompt
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return { provider: "anthropic", apiKey: anthropicKey, model: "claude-sonnet-4-6" };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return { provider: "openai", apiKey: openaiKey, model: "gpt-4o" };
  }
  // Check Ollama — verify it's running AND has at least one model
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as { models?: Array<{ name: string }> };
      const models = data.models || [];
      if (models.length > 0) {
        // Pick the first available model
        const modelName = models[0].name.replace(/:latest$/, "");
        return { provider: "ollama", apiKey: "ollama", model: modelName };
      }
      // Ollama running but no models downloaded — skip
    }
  } catch { /* Ollama not available */ }
  return null;
}

function bootstrapEcosystem(): boolean {
  const home = os.homedir();
  const corePath = path.join(home, ".acore", "core.md");
  if (fs.existsSync(corePath)) return false;

  fs.mkdirSync(path.join(home, ".acore"), { recursive: true });
  fs.writeFileSync(corePath, [
    "# Aman",
    "",
    "## Personality",
    "Helpful, adaptive, and thoughtful. Matches the user's tone and needs.",
    "",
    "## Style",
    "Clear and concise. Prioritizes usefulness over verbosity.",
    "",
    "## Session",
    "_New companion — no prior sessions._",
  ].join("\n"), "utf-8");

  const rulesDir = path.join(home, ".arules");
  const rulesPath = path.join(rulesDir, "rules.md");
  if (!fs.existsSync(rulesPath)) {
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(rulesPath, [
      "# Guardrails",
      "",
      "## safety",
      "- Never execute destructive commands without explicit confirmation",
      "- Never expose API keys, passwords, or secrets in responses",
      "",
      "## behavior",
      '- Be honest when uncertain — say "I\'m not sure" rather than guessing',
      "- Respect the user's preferences stored in memory",
    ].join("\n"), "utf-8");
  }

  return true;
}

const program = new Command();

program
  .name("aman-agent")
  .description("Your AI companion, running locally")
  .version(__VERSION__)
  .option("--model <model>", "Override LLM model")
  .option("--budget <tokens>", "Token budget for system prompt (default: 8000)", parseInt)
  .option("--profile <name>", "Use a specific agent profile (e.g., coder, writer, researcher)")
  .action(async (options) => {
    p.intro(pc.bold("aman agent") + pc.dim(" — your AI companion"));

    // Setup config if needed
    let config = loadConfig();
    if (!config) {
      const detected = await autoDetectConfig();
      if (detected) {
        config = detected;
        const providerLabel =
          detected.provider === "anthropic" ? "Anthropic API key" :
          detected.provider === "openai" ? "OpenAI API key" : "Ollama";
        p.log.success(`Auto-detected ${providerLabel}. Using ${pc.bold(detected.model)}.`);
        p.log.info(pc.dim("Change anytime with /reset config"));
        saveConfig(config);
      } else {
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
              { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "fast, recommended" },
              { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "most capable" },
              { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fastest, cheapest" },
              { value: "custom", label: "Custom model ID" },
            ],
            initialValue: "claude-sonnet-4-6",
          })) as string;
          if (p.isCancel(modelChoice)) process.exit(0);

          if (modelChoice === "custom") {
            const customModel = (await p.text({
              message: "Model ID",
              placeholder: "claude-sonnet-4-6",
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
    }

    // Override model if specified
    const model = options.model || config.model;

    // Spinner: bootstrap ecosystem + load system prompt
    const s = p.spinner();
    s.start("Loading ecosystem");

    bootstrapEcosystem();

    // Resolve profile
    const profile = options.profile || process.env.AMAN_PROFILE || undefined;
    if (profile) {
      p.log.info(`Profile: ${pc.bold(profile)}`);
    }

    // Assemble system prompt from ecosystem with token budget
    const budget = options.budget || undefined;
    const { prompt: systemPrompt, layers, truncated, totalTokens } = assembleSystemPrompt(budget, profile);

    s.stop("Ecosystem loaded");

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

    // Extract AI name from core.md
    const aiName = getProfileAiName(profile);

    // Initialize memory (in-process, replaces amem MCP)
    try {
      await initMemory();
    } catch (err) {
      p.log.warning(`Memory initialization failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Memory consolidation (in-process via amem-core)
    if (isMemoryInitialized()) {
      const memSpinner = p.spinner();
      memSpinner.start("Consolidating memory");
      try {
        const report = memoryConsolidate();
        memSpinner.stop("Memory consolidated");
        if (report.merged > 0 || report.pruned > 0 || report.promoted > 0) {
          p.log.info(
            `Memory health: ${report.healthScore ?? "?"}% ` +
            pc.dim(`(merged ${report.merged}, pruned ${report.pruned}, promoted ${report.promoted})`),
          );
        }
      } catch {
        memSpinner.stop("Memory consolidation skipped");
      }
    }

    // Start MCP servers
    const mcpManager = new McpManager();

    const mcpSpinner = p.spinner();
    mcpSpinner.start("Connecting to MCP servers");

    // Core MCP servers (always connect)
    await mcpManager.connect("aman", "npx", ["-y", "@aman_asmuei/aman-mcp"]);

    // Connect custom MCP servers from config
    // Users add these via: ~/.aman-agent/config.json → "mcpServers": { "name": { command, args } }
    // Or via akit: akit add docling → then add to config
    if (config.mcpServers) {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        if (name === "aman" || name === "amem") continue;
        await mcpManager.connect(name, serverConfig.command, serverConfig.args);
      }
    }

    const mcpTools = mcpManager.getTools();

    mcpSpinner.stop("MCP connected");

    if (mcpTools.length > 0) {
      p.log.success(`${mcpTools.length} MCP tools available`);
    } else {
      p.log.info(
        "No MCP tools connected (install aman-mcp for tool support)",
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

    p.log.success(`${pc.bold(aiName)} is ready. Model: ${pc.dim(model)}`);

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

program
  .command("init")
  .description("Set up your AI companion with a guided wizard")
  .action(async () => {
    p.intro(pc.bold("aman agent init") + pc.dim(" — set up your companion"));

    const name = (await p.text({
      message: "What should your companion be called?",
      placeholder: "Aman",
      defaultValue: "Aman",
    })) as string;
    if (p.isCancel(name)) process.exit(0);

    const preset = (await p.select({
      message: "What kind of companion do you need?",
      options: [
        { value: "coding", label: "Coding Partner", hint: "direct, technical, concise" },
        { value: "creative", label: "Creative Collaborator", hint: "warm, imaginative" },
        { value: "assistant", label: "Personal Assistant", hint: "organized, action-oriented" },
        { value: "learning", label: "Learning Buddy", hint: "patient, Socratic" },
        { value: "minimal", label: "Minimal", hint: "just chat, I'll customize later" },
      ],
      initialValue: "coding",
    })) as PresetName;
    if (p.isCancel(preset)) process.exit(0);

    const result = applyPreset(preset, name || "Aman");
    const home = os.homedir();

    fs.mkdirSync(path.join(home, ".acore"), { recursive: true });
    fs.writeFileSync(path.join(home, ".acore", "core.md"), result.coreMd, "utf-8");
    p.log.success(`Identity created — ${PRESETS[preset].identity.personality.split(".")[0].toLowerCase()}`);

    if (result.rulesMd) {
      fs.mkdirSync(path.join(home, ".arules"), { recursive: true });
      fs.writeFileSync(path.join(home, ".arules", "rules.md"), result.rulesMd, "utf-8");
      const ruleCount = (result.rulesMd.match(/^- /gm) || []).length;
      p.log.success(`${ruleCount} rules set`);
    }

    if (result.flowMd) {
      fs.mkdirSync(path.join(home, ".aflow"), { recursive: true });
      fs.writeFileSync(path.join(home, ".aflow", "flow.md"), result.flowMd, "utf-8");
      const wfCount = (result.flowMd.match(/^## /gm) || []).length;
      p.log.success(`${wfCount} workflow${wfCount > 1 ? "s" : ""} added`);
    }

    // Detect if running via npx (temp install)
    const isNpx = process.argv[1]?.includes("_npx") || !process.argv[1]?.includes("node_modules/.bin");

    p.outro("Your companion is ready.");

    console.log("");
    if (isNpx) {
      console.log(`  ${pc.bold("Start chatting:")}  npx @aman_asmuei/aman-agent`);
      console.log("");
      console.log(`  ${pc.dim("Tip: Install globally to use")} ${pc.bold("aman-agent")} ${pc.dim("directly:")}`);
      console.log(`  ${pc.dim("  npm install -g @aman_asmuei/aman-agent")}`);
    } else {
      console.log(`  ${pc.bold("Start chatting:")}  aman-agent`);
    }
    console.log("");
    console.log(`  ${pc.dim("Add tools:")}  npx @aman_asmuei/akit add github`);
    console.log(`  ${pc.dim("Browse:")}     npx @aman_asmuei/akit search <query>`);
    console.log("");
  });

program.parse();
