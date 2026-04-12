import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig, identityDir, rulesDir, workflowsDir, skillsDir, memoryDir, homeDir } from "./config.js";
import { migrateIfNeeded } from "./migrate.js";
import { assembleSystemPrompt, getProfileAiName } from "./prompt.js";
import { pickLLMClient } from "./llm/index.js";
import { isClaudeCliInstalled } from "./llm/claude-code.js";
import { isCopilotCliInstalled, isCopilotCliAuthenticated } from "./llm/copilot.js";
import { McpManager } from "./mcp/client.js";
import { runAgent } from "./agent.js";
import fs from "node:fs";
import path from "node:path";
import { applyPreset, PRESETS, type PresetName } from "./presets.js";
import { initMemory, memoryConsolidate, isMemoryInitialized, setMemoryConfig } from "./memory.js";
import { hasUserIdentity, loadUserIdentity } from "./user-identity.js";
import { runOnboarding } from "./onboarding.js";
import { runServe } from "./server/serve-command.js";

declare const __VERSION__: string;

interface AutoDetectedConfig {
  provider: "anthropic" | "openai" | "ollama" | "claude-code" | "copilot";
  apiKey: string;
  model: string;
}

async function autoDetectConfig(): Promise<AutoDetectedConfig | null> {
  // Skip auto-detect if user just ran /reset config
  const reconfigMarker = path.join(homeDir(), ".reconfig");
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
  const corePath = path.join(identityDir(), "core.md");
  if (fs.existsSync(corePath)) return false;

  fs.mkdirSync(identityDir(), { recursive: true });
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

  const rulesPath = path.join(rulesDir(), "rules.md");
  if (!fs.existsSync(rulesPath)) {
    fs.mkdirSync(rulesDir(), { recursive: true });
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

  const flowPath = path.join(workflowsDir(), "flow.md");
  if (!fs.existsSync(flowPath)) {
    fs.mkdirSync(workflowsDir(), { recursive: true });
    fs.writeFileSync(flowPath, "# Workflows\n\n_No workflows defined yet. Use /workflows add to create one._\n", "utf-8");
  }

  const skillPath = path.join(skillsDir(), "skills.md");
  if (!fs.existsSync(skillPath)) {
    fs.mkdirSync(skillsDir(), { recursive: true });
    fs.writeFileSync(skillPath, "# Skills\n\n_No skills installed yet. Use /skills install to add domain expertise._\n", "utf-8");
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
        // Non-interactive (systemd, Docker without -it, CI) — fail clearly
        if (!process.stdin.isTTY) {
          console.error("Error: No LLM provider configured.");
          console.error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or run interactively: aman-agent");
          process.exit(1);
        }

        p.log.info("First-time setup — configure your LLM connection.");

        const provider = (await p.select({
          message: "LLM provider",
          options: [
            {
              value: "claude-code",
              label: "Claude (Anthropic)",
              hint: "recommended",
            },
            {
              value: "copilot",
              label: "GitHub Copilot",
              hint: "uses GitHub Models",
            },
            { value: "openai", label: "GPT (OpenAI)" },
            { value: "ollama", label: "Ollama (local)", hint: "free, runs offline" },
          ],
          initialValue: "claude-code",
        })) as "openai" | "ollama" | "claude-code" | "copilot";
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
        } else if (provider === "claude-code") {
          // Claude via Claude Code CLI — handles subscription, API, and 3rd-party auth
          p.note(
            [
              `${pc.bold("Claude Plans:")}`,
              "",
              `  ${pc.cyan("Free")}          $0/mo       Basic access`,
              `  ${pc.cyan("Pro")}           $20/mo      Full models + Claude Code`,
              `  ${pc.cyan("Max 5x")}        $100/mo     5× usage + Claude Code`,
              `  ${pc.cyan("Max 20x")}       $200/mo     20× usage + Opus 4.6 + 1M context`,
              `  ${pc.cyan("Team")}          $25+/seat   Collaborative workspace`,
              `  ${pc.cyan("Enterprise")}    Custom      SSO, admin, dedicated support`,
              "",
              `${pc.dim("Authentication is handled by Claude Code CLI.")}`,
              `${pc.dim("Supports: subscription, API billing, Bedrock, Vertex AI.")}`,
            ].join("\n"),
            "Claude Plans",
          );

          // Check if claude CLI is installed
          if (!isClaudeCliInstalled()) {
            p.log.error("Claude Code CLI is not installed.");
            p.log.info("Install it with:");
            p.log.step(pc.bold("npm install -g @anthropic-ai/claude-code"));
            p.log.info(pc.dim("Then re-run aman-agent to continue setup."));
            process.exit(1);
          }

          p.log.success("Claude Code CLI detected.");

          // Check auth / offer login
          const authAction = (await p.select({
            message: "Authentication",
            options: [
              { value: "logged-in", label: "Already logged in to Claude Code" },
              { value: "login", label: "Log in now", hint: "runs: claude login" },
            ],
          })) as string;
          if (p.isCancel(authAction)) process.exit(0);

          if (authAction === "login") {
            p.log.step("Launching Claude Code login...");
            const { spawnSync } = await import("node:child_process");
            const loginResult = spawnSync("claude", ["login"], {
              stdio: "inherit",
            });
            if (loginResult.status !== 0) {
              p.log.error("Login failed or was cancelled. Please try again.");
              process.exit(1);
            }
            p.log.success("Login successful.");
          }

          apiKey = "claude-code"; // Sentinel — auth handled by CLI

          const modelChoice = (await p.select({
            message: "Claude model",
            options: [
              { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "fast, recommended" },
              { value: "claude-opus-4-6", label: "Claude Opus 4.6", hint: "most capable" },
              { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fastest" },
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
        } else if (provider === "copilot") {
          // GitHub Copilot via Copilot CLI
          p.note(
            [
              `${pc.bold("GitHub Copilot Plans:")}`,
              "",
              `  ${pc.cyan("Free")}          $0/mo       2,000 code completions + 50 chat msgs`,
              `  ${pc.cyan("Pro")}           $10/mo      Unlimited completions + chat`,
              `  ${pc.cyan("Pro+")}          $39/mo      Unlimited + Opus/o1 + agent mode`,
              `  ${pc.cyan("Business")}      $19/user/mo Team admin + policy controls`,
              `  ${pc.cyan("Enterprise")}    $39/user/mo SSO, audit logs, IP indemnity`,
              "",
              `${pc.dim("Authentication is handled by the Copilot CLI.")}`,
              `${pc.dim("Subscribe at: https://github.com/features/copilot")}`,
            ].join("\n"),
            "Copilot Plans",
          );

          // Check if copilot CLI is installed
          if (!isCopilotCliInstalled()) {
            p.log.error("Copilot CLI is not installed.");
            p.log.info("Install it from:");
            p.log.step(pc.bold("https://docs.github.com/copilot/how-tos/copilot-cli"));
            p.log.info(pc.dim("Then re-run aman-agent to continue setup."));
            process.exit(1);
          }

          p.log.success("Copilot CLI detected.");

          // Check auth / offer login
          const copilotAuth = isCopilotCliAuthenticated();
          if (copilotAuth) {
            p.log.success("Copilot authentication found.");
          } else {
            p.log.warn("Not logged in to Copilot.");
            const authAction = (await p.select({
              message: "Authentication",
              options: [
                { value: "login", label: "Log in now", hint: "runs: copilot login" },
                { value: "skip", label: "Skip (I'll log in later)" },
              ],
            })) as string;
            if (p.isCancel(authAction)) process.exit(0);

            if (authAction === "login") {
              p.log.step("Launching Copilot login...");
              const { spawnSync } = await import("node:child_process");
              const loginResult = spawnSync("copilot", ["login"], {
                stdio: "inherit",
              });
              if (loginResult.status !== 0) {
                p.log.error("Login failed or was cancelled.");
                process.exit(1);
              }
              p.log.success("Copilot login successful.");
            }
          }

          apiKey = "copilot"; // Sentinel — auth handled by CLI

          const modelChoice = (await p.select({
            message: "Model",
            options: [
              { value: "default", label: "Default", hint: "Copilot's default model" },
              { value: "gpt-4o", label: "GPT-4o", hint: "fast" },
              { value: "gpt-5.2", label: "GPT-5.2", hint: "most capable" },
              { value: "o3-mini", label: "o3-mini", hint: "reasoning" },
              { value: "custom", label: "Custom model ID" },
            ],
            initialValue: "default",
          })) as string;
          if (p.isCancel(modelChoice)) process.exit(0);

          if (modelChoice === "custom") {
            const customModel = (await p.text({
              message: "Model ID (run copilot --help for available models)",
              placeholder: "gpt-4o",
              validate: (v) => v.length === 0 ? "Model ID is required" : undefined,
            })) as string;
            if (p.isCancel(customModel)) process.exit(0);
            defaultModel = customModel;
          } else if (modelChoice === "default") {
            defaultModel = "";
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

    // Migrate old scattered directories to consolidated layout
    const migration = migrateIfNeeded();
    if (migration.migrated.length > 0) {
      for (const dir of migration.migrated) {
        p.log.info(`Migrated → ~/.aman-agent/${dir}/`);
      }
    }

    // Point ecosystem libs at consolidated layout
    process.env.ACORE_HOME = identityDir();
    process.env.ARULES_HOME = rulesDir();
    process.env.AMEM_DIR = memoryDir();

    const isFirstRun = bootstrapEcosystem();

    // User onboarding — runs once on first launch
    if (!hasUserIdentity()) {
      s.stop("Ecosystem loaded");
      const user = await runOnboarding();
      if (!user) {
        p.log.info("Skipped profile setup. You can set it up later with /profile edit");
      }
      s.start("Loading ecosystem");
    }

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
    if (config.memory) setMemoryConfig(config.memory);
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

    // Core MCP servers (always connect) + custom servers — all in parallel
    const connections: Promise<void>[] = [
      mcpManager.connect("aman", "npx", ["-y", "@aman_asmuei/aman-mcp"]),
    ];
    if (config.mcpServers) {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        if (name === "aman" || name === "amem") continue;
        connections.push(mcpManager.connect(name, serverConfig.command, serverConfig.args, serverConfig.env));
      }
    }
    await Promise.all(connections);

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
    const client = pickLLMClient(config, model);

    const userIdentity = loadUserIdentity();
    if (userIdentity) {
      p.log.success(`${pc.bold(aiName)} is ready for ${pc.bold(userIdentity.name)}. Model: ${pc.dim(model)}`);
    } else {
      p.log.success(`${pc.bold(aiName)} is ready. Model: ${pc.dim(model)}`);
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

    fs.mkdirSync(identityDir(), { recursive: true });
    fs.writeFileSync(path.join(identityDir(), "core.md"), result.coreMd, "utf-8");
    p.log.success(`Identity created — ${PRESETS[preset].identity.personality.split(".")[0].toLowerCase()}`);

    if (result.rulesMd) {
      fs.mkdirSync(rulesDir(), { recursive: true });
      fs.writeFileSync(path.join(rulesDir(), "rules.md"), result.rulesMd, "utf-8");
      const ruleCount = (result.rulesMd.match(/^- /gm) || []).length;
      p.log.success(`${ruleCount} rules set`);
    }

    if (result.flowMd) {
      fs.mkdirSync(workflowsDir(), { recursive: true });
      fs.writeFileSync(path.join(workflowsDir(), "flow.md"), result.flowMd, "utf-8");
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

program
  .command("serve")
  .description("Run aman-agent as a local MCP server other agents can delegate to")
  .requiredOption("--name <name>", "Unique handle for @-mention (e.g. 'coder')")
  .option("--profile <profile>", "Which profile to load", "default")
  .action(async (opts) => {
    try {
      await runServe({ name: opts.name, profile: opts.profile });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`aman-agent serve failed: ${msg}`));
      process.exit(1);
    }
  });

program
  .command("dev [path]")
  .description("Set up project context and start Claude Code")
  .option("--smart", "Use LLM to generate CLAUDE.md")
  .option("--no-launch", "Generate CLAUDE.md only, don't start claude")
  .option("--force", "Regenerate even if CLAUDE.md is fresh")
  .option("--diff", "Show what would change without writing")
  .action(async (projectPath: string | undefined, opts: Record<string, boolean>) => {
    const { runDev } = await import("./dev/dev-command.js");
    const { scanStack } = await import("./dev/stack-detector.js");

    const targetPath = projectPath ?? process.cwd();
    const stack = scanStack(targetPath);

    // Print detection
    const stackParts = stack.languages.map((l: string) => l.charAt(0).toUpperCase() + l.slice(1));
    if (stack.frameworks.length > 0) {
      stackParts.push(`(${stack.frameworks.map((f: string) => f.charAt(0).toUpperCase() + f.slice(1)).join(", ")})`);
    }
    if (stack.databases.length > 0) {
      stackParts.push(...stack.databases.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1)));
    }
    if (stack.infra.length > 0) {
      stackParts.push(...stack.infra.map((i: string) => i.charAt(0).toUpperCase() + i.slice(1)));
    }

    if (stack.languages.length > 0) {
      console.log(`\n  ${pc.cyan("Detected:")} ${stackParts.join(" + ")}`);
    } else {
      console.log(`\n  ${pc.dim("No stack detected — generating minimal CLAUDE.md")}`);
    }

    const result = await runDev(targetPath, {
      smart: opts.smart,
      noLaunch: opts.launch === false,
      force: opts.force,
      diff: opts.diff,
    }, stack);

    if (!result.success) {
      console.error(`  ${pc.red("Error:")} ${result.error}`);
      process.exit(1);
    }

    if (result.diff) {
      console.log(`\n${result.diff}`);
      return;
    }

    if (result.generated) {
      const mode = opts.smart ? "smart" : "template";
      const memCount = result.context?.metadata.memoriesUsed ?? 0;
      console.log(`  ${pc.cyan("Recalled:")} ${memCount} memories`);
      console.log(`  ${pc.green("✓")} CLAUDE.md written (${mode} mode)\n`);
    } else if (result.skippedReason === "fresh") {
      console.log(`  ${pc.green("✓")} CLAUDE.md is up to date\n`);
    }

    // Launch Claude Code
    if (opts.launch !== false && !opts.diff) {
      const { execFileSync } = await import("node:child_process");
      try {
        execFileSync("which", ["claude"], { stdio: "ignore" });
      } catch {
        console.log(`  ${pc.yellow("Claude Code not found.")} Install: npm install -g @anthropic-ai/claude-code`);
        process.exit(1);
      }
      console.log(`  ${pc.cyan("Launching Claude Code...")}\n`);
      execFileSync("claude", [], { cwd: targetPath, stdio: "inherit" });
    }
  });

program
  .command("setup")
  .description("Run the full configuration wizard (provider, identity, presets)")
  .action(async () => {
    p.intro(pc.bold("aman agent setup") + pc.dim(" — full configuration wizard"));

    // Create .reconfig marker to force interactive provider selection on next run
    const reconfigPath = path.join(homeDir(), ".reconfig");
    fs.mkdirSync(homeDir(), { recursive: true });
    fs.writeFileSync(reconfigPath, "", "utf-8");

    p.log.info("Configuration reset. Restart aman-agent to complete setup.");
  });

program
  .command("update")
  .description("Update aman-agent to the latest version")
  .action(async () => {
    const { execFileSync } = await import("node:child_process");
    const isVendored = process.execPath.includes(path.join(".aman-agent", "node"));

    if (isVendored) {
      const npmPath = path.join(homeDir(), "node", "bin", "npm");
      console.log("Updating aman-agent...");
      try {
        execFileSync(npmPath, ["install", "-g", "@aman_asmuei/aman-agent@latest"], {
          stdio: "inherit",
          env: { ...process.env, PREFIX: homeDir() },
        });
        console.log("✓ Updated successfully.");
      } catch {
        console.error("Update failed. Try manually: npm install -g @aman_asmuei/aman-agent@latest");
        process.exit(1);
      }
    } else {
      console.log("Updating via npm...");
      try {
        execFileSync("npm", ["install", "-g", "@aman_asmuei/aman-agent@latest"], {
          stdio: "inherit",
        });
        console.log("✓ Updated successfully.");
      } catch {
        console.error("Update failed. Try manually: npm install -g @aman_asmuei/aman-agent@latest");
        process.exit(1);
      }
    }
  });

program
  .command("uninstall")
  .description("Remove aman-agent and all its data")
  .action(async () => {
    const home = homeDir();

    if (!process.stdin.isTTY) {
      fs.rmSync(home, { recursive: true, force: true });
      console.log("✓ Removed " + home);
      return;
    }

    const confirm = await p.confirm({
      message: `This will delete ${home} and all your data (memory, identity, config). Continue?`,
    });
    if (!confirm || p.isCancel(confirm)) {
      console.log("Cancelled.");
      return;
    }

    fs.rmSync(home, { recursive: true, force: true });
    console.log("✓ Removed " + home);
    console.log("");
    console.log("To complete uninstall, remove the PATH line from your shell config:");
    console.log('  Remove: export PATH="$HOME/.aman-agent/bin:$PATH"');
  });

program.parse();
