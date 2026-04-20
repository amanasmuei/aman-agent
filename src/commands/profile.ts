import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import { listProfiles } from "../prompt.js";
import { BUILT_IN_PROFILES, installProfileTemplate } from "../profile-templates.js";
import { loadUserIdentity } from "../user-identity.js";
import { runOnboarding, editProfile } from "../onboarding.js";
import type { CommandResult } from "./shared.js";

export function handleProfileCommand(action: string | undefined, args: string[]): CommandResult {
  const profilesDir = path.join(os.homedir(), ".acore", "profiles");

  if (action === "me") {
    const user = loadUserIdentity();
    if (!user) {
      return { handled: true, output: pc.dim("No user profile yet. Run /profile edit to set one up.") };
    }
    const lines = [
      `  ${pc.bold("Name:")}       ${user.name}`,
      `  ${pc.bold("Role:")}       ${user.roleLabel}`,
      `  ${pc.bold("Expertise:")}  ${user.expertiseLabel}`,
      `  ${pc.bold("Style:")}      ${user.styleLabel}`,
    ];
    if (user.workingOn) lines.push(`  ${pc.bold("Working on:")} ${user.workingOn}`);
    if (user.notes) lines.push(`  ${pc.bold("Notes:")}      ${user.notes}`);
    lines.push(`  ${pc.dim(`Updated: ${user.updatedAt}`)}`);
    return { handled: true, output: `Your profile:\n${lines.join("\n")}\n\n${pc.dim("Edit with: /profile edit")}` };
  }

  if (action === "edit") {
    const current = loadUserIdentity();
    if (!current) {
      runOnboarding().then(() => {}).catch(() => {});
      return { handled: true, output: "" };
    }
    editProfile(current).then(() => {}).catch(() => {});
    return { handled: true, output: "" };
  }

  if (action === "setup") {
    runOnboarding().then(() => {}).catch(() => {});
    return { handled: true, output: "" };
  }

  if (!action || action === "list") {
    const profiles = listProfiles();
    const user = loadUserIdentity();
    const userLine = user
      ? `${pc.bold("You:")} ${user.name} (${user.roleLabel}, ${user.expertiseLabel})\n\n`
      : `${pc.dim("No user profile. Set up with: /profile edit")}\n\n`;

    if (profiles.length === 0) {
      return { handled: true, output: userLine + pc.dim("No agent profiles yet. Create one with: /profile create <name>") };
    }
    const lines = profiles.map((p) =>
      `  ${pc.bold(p.name)} \u2014 ${p.aiName} (${pc.dim(p.personality)})`
    );
    return { handled: true, output: userLine + "Agent profiles:\n" + lines.join("\n") + "\n\n" + pc.dim("Switch with: aman-agent --profile <name>") };
  }

  switch (action) {
    case "create": {
      const name = args[0];
      if (!name) {
        const lines = BUILT_IN_PROFILES.map((t) =>
          `  ${pc.bold(t.name)} \u2014 ${t.label}: ${pc.dim(t.description)}`
        );
        return {
          handled: true,
          output: "Built-in profiles:\n" + lines.join("\n") +
            "\n\nUsage:\n  /profile create coder     Install built-in template" +
            "\n  /profile create <custom>  Create blank profile",
        };
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const profileDir = path.join(profilesDir, slug);

      if (fs.existsSync(profileDir)) {
        return { handled: true, output: pc.yellow(`Profile already exists: ${slug}`) };
      }

      const builtIn = BUILT_IN_PROFILES.find((t) => t.name === slug);
      if (builtIn) {
        const err = installProfileTemplate(slug);
        if (err) return { handled: true, output: pc.red(err) };
        return {
          handled: true,
          output: pc.green(`Profile installed: ${builtIn.label}`) +
            `\n  AI name: ${builtIn.core.match(/^# (.+)/m)?.[1] || slug}` +
            `\n  ${pc.dim(builtIn.description)}` +
            `\n\n  Use: aman-agent --profile ${slug}`,
        };
      }

      fs.mkdirSync(profileDir, { recursive: true });
      const globalCore = path.join(os.homedir(), ".acore", "core.md");
      if (fs.existsSync(globalCore)) {
        let content = fs.readFileSync(globalCore, "utf-8");
        const aiName = name.charAt(0).toUpperCase() + name.slice(1);
        content = content.replace(/^# .+$/m, `# ${aiName}`);
        fs.writeFileSync(path.join(profileDir, "core.md"), content, "utf-8");
      } else {
        const aiName = name.charAt(0).toUpperCase() + name.slice(1);
        fs.writeFileSync(path.join(profileDir, "core.md"), `# ${aiName}\n\n## Identity\n- Role: ${aiName} is your AI companion\n- Personality: helpful, adaptive\n- Communication: clear and concise\n- Values: honesty, simplicity\n- Boundaries: won't pretend to be human\n`, "utf-8");
      }

      return {
        handled: true,
        output: pc.green(`Profile created: ${slug}`) +
          `\n  Edit: ${path.join(profileDir, "core.md")}` +
          `\n  Use: aman-agent --profile ${slug}` +
          `\n\n  ${pc.dim("Add rules.md or skills.md for profile-specific overrides.")}`,
      };
    }

    case "show": {
      const name = args[0];
      if (!name) return { handled: true, output: pc.yellow("Usage: /profile show <name>") };
      const profileDir = path.join(profilesDir, name);
      if (!fs.existsSync(profileDir)) return { handled: true, output: pc.red(`Profile not found: ${name}`) };

      const files = fs.readdirSync(profileDir).filter((f) => f.endsWith(".md"));
      const lines = files.map((f) => `  ${f}`);
      return { handled: true, output: `Profile: ${pc.bold(name)}\nFiles:\n${lines.join("\n")}` };
    }

    case "delete": {
      const name = args[0];
      if (!name) return { handled: true, output: pc.yellow("Usage: /profile delete <name>") };
      const profileDir = path.join(profilesDir, name);
      if (!fs.existsSync(profileDir)) return { handled: true, output: pc.red(`Profile not found: ${name}`) };

      fs.rmSync(profileDir, { recursive: true });
      return { handled: true, output: pc.dim(`Profile deleted: ${name}`) };
    }

    case "help":
      return { handled: true, output: `Profile commands:

  ${pc.bold("Your profile:")}
  /profile me           View your profile
  /profile edit         Edit your profile
  /profile setup        Re-run full profile setup

  ${pc.bold("Agent profiles:")}
  /profile              List all profiles
  /profile create <n>   Create new agent profile
  /profile show <n>     Show agent profile files
  /profile delete <n>   Delete an agent profile

  ${pc.bold("Use agent profiles:")}
  aman-agent --profile <name>
  AMAN_PROFILE=<name> aman-agent` };

    default:
      return { handled: true, output: pc.yellow(`Unknown profile action: ${action}. Try /profile help`) };
  }
}
