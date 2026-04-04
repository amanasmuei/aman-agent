import * as p from "@clack/prompts";
import pc from "picocolors";
import type { UserIdentity } from "./user-identity.js";
import { saveUserIdentity } from "./user-identity.js";
import { loadShowcaseManifest, installShowcaseTemplate, type ShowcaseOption } from "./showcase-bridge.js";

/**
 * Run the interactive onboarding flow for first-time users.
 * Captures user identity with personality-driven questions.
 * Returns the saved UserIdentity.
 */
export async function runOnboarding(): Promise<UserIdentity | null> {
  console.log("");
  p.intro(pc.bold("Let's get to know each other"));
  p.log.info(pc.dim("Quick setup so I can be actually useful to you. Takes ~30 seconds."));

  // --- Name ---
  const name = await p.text({
    message: "What should I call you?",
    placeholder: "Your name or nickname",
    validate: (v) => (v.trim().length === 0 ? "I need something to call you!" : undefined),
  });
  if (p.isCancel(name)) return null;

  // --- Role ---
  const role = await p.select({
    message: `Nice to meet you, ${pc.bold(name)}! What's your main thing?`,
    options: [
      { value: "developer", label: "Building things", hint: "developer, engineer, maker" },
      { value: "designer", label: "Designing things", hint: "UI/UX, creative, visual" },
      { value: "student", label: "Learning things", hint: "student, researcher, exploring" },
      { value: "manager", label: "Running things", hint: "lead, PM, coordinator" },
      { value: "generalist", label: "A bit of everything", hint: "jack of all trades" },
    ],
    initialValue: "developer",
  });
  if (p.isCancel(role)) return null;

  const ROLE_LABELS: Record<string, string> = {
    developer: "Developer / Engineer",
    designer: "Designer / Creative",
    student: "Student / Researcher",
    manager: "Lead / Manager",
    generalist: "Generalist",
  };

  // --- Expertise ---
  const expertise = await p.select({
    message: "How deep in the game are you?",
    options: [
      { value: "beginner", label: "Just getting started", hint: "explain everything, I'm here to learn" },
      { value: "intermediate", label: "Know my way around", hint: "skip the basics, get to the point" },
      { value: "advanced", label: "Been at it for years", hint: "show me the advanced stuff" },
      { value: "expert", label: "I wrote the book", hint: "challenge me, peer-level talk" },
    ],
    initialValue: "intermediate",
  });
  if (p.isCancel(expertise)) return null;

  const EXPERTISE_LABELS: Record<string, string> = {
    beginner: "Getting Started",
    intermediate: "Intermediate",
    advanced: "Advanced",
    expert: "Expert",
  };

  // --- Communication Style ---
  const style = await p.select({
    message: "How do you like your answers?",
    options: [
      { value: "concise", label: "Short and sharp", hint: "code first, talk later" },
      { value: "balanced", label: "Balanced", hint: "explain the why, show the how" },
      { value: "thorough", label: "Deep and detailed", hint: "I want to understand everything" },
      { value: "socratic", label: "Make me think", hint: "ask questions, guide me there" },
    ],
    initialValue: "balanced",
  });
  if (p.isCancel(style)) return null;

  const STYLE_LABELS: Record<string, string> = {
    concise: "Concise — code first, talk later",
    balanced: "Balanced — explain and show",
    thorough: "Thorough — deep explanations",
    socratic: "Socratic — guide with questions",
  };

  // --- Working On (optional) ---
  const workingOn = await p.text({
    message: "What are you working on right now? " + pc.dim("(optional, press Enter to skip)"),
    placeholder: "e.g. a React app, a CLI tool, learning Python...",
    defaultValue: "",
  });
  if (p.isCancel(workingOn)) return null;

  // --- Notes (optional) ---
  const notes = await p.text({
    message: "Anything else I should know about you? " + pc.dim("(optional)"),
    placeholder: "e.g. I prefer TypeScript, I work on a Mac, I'm in GMT+8...",
    defaultValue: "",
  });
  if (p.isCancel(notes)) return null;

  // --- Build and save ---
  const today = new Date().toISOString().split("T")[0];

  const user: UserIdentity = {
    name: (name as string).trim(),
    role: role as UserIdentity["role"],
    roleLabel: ROLE_LABELS[role as string] || "Generalist",
    expertise: expertise as UserIdentity["expertise"],
    expertiseLabel: EXPERTISE_LABELS[expertise as string] || "Intermediate",
    style: style as UserIdentity["style"],
    styleLabel: STYLE_LABELS[style as string] || "Balanced",
    workingOn: (workingOn as string).trim() || undefined,
    notes: (notes as string).trim() || undefined,
    createdAt: today,
    updatedAt: today,
  };

  saveUserIdentity(user);

  // --- Showcase Template (optional) ---
  let showcaseInstalled: string | null = null;
  const showcases = loadShowcaseManifest();
  if (showcases.length > 0) {
    console.log("");
    const wantShowcase = await p.confirm({
      message: "Want to give your companion a specialty? " + pc.dim("(pre-built personalities with workflows)"),
      initialValue: false,
    });

    if (!p.isCancel(wantShowcase) && wantShowcase) {
      // Group by category for nicer display
      const categories = new Map<string, ShowcaseOption[]>();
      for (const s of showcases) {
        if (!categories.has(s.category)) categories.set(s.category, []);
        categories.get(s.category)!.push(s);
      }

      const options: Array<{ value: string; label: string; hint: string }> = [];
      for (const [category, items] of categories) {
        for (const item of items) {
          const langBadge = item.language === "ms" ? " [BM]" : item.language === "en+ms" ? " [EN/BM]" : "";
          options.push({
            value: item.name,
            label: `${item.title}${langBadge}`,
            hint: item.description.slice(0, 70) + (item.description.length > 70 ? "..." : ""),
          });
        }
      }

      const chosen = await p.select({
        message: "Pick a companion specialty",
        options,
      });

      if (!p.isCancel(chosen)) {
        const chosenName = chosen as string;
        try {
          const result = installShowcaseTemplate(chosenName);
          if (result.installed.length > 0) {
            showcaseInstalled = chosenName;
            const entry = showcases.find((s) => s.name === chosenName);
            p.log.success(`Installed ${pc.bold(entry?.title || chosenName)}`);
            for (const f of result.installed) {
              process.stdout.write(pc.dim(`  ${f}\n`));
            }
            if (result.backed_up.length > 0) {
              p.log.info(pc.dim(`Backed up ${result.backed_up.length} existing file(s) (.bak)`));
            }
          }
        } catch (err) {
          p.log.warning(`Could not install showcase: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  // --- Confirmation ---
  console.log("");
  p.log.success(`Profile saved for ${pc.bold(user.name)}`);

  const summary = [
    `  ${pc.dim("Role:")}       ${user.roleLabel}`,
    `  ${pc.dim("Level:")}      ${user.expertiseLabel}`,
    `  ${pc.dim("Style:")}      ${user.styleLabel}`,
  ];
  if (user.workingOn) {
    summary.push(`  ${pc.dim("Working on:")} ${user.workingOn}`);
  }
  if (showcaseInstalled) {
    const entry = showcases.find((s) => s.name === showcaseInstalled);
    summary.push(`  ${pc.dim("Specialty:")}  ${entry?.title || showcaseInstalled}`);
  }
  console.log(summary.join("\n"));
  console.log("");

  p.log.info(pc.dim("Update anytime with /profile edit"));

  return user;
}

/**
 * Quick profile update — edit specific fields.
 * Returns updated identity or null if cancelled.
 */
export async function editProfile(current: UserIdentity): Promise<UserIdentity | null> {
  const field = await p.select({
    message: "What do you want to update?",
    options: [
      { value: "name", label: "Name", hint: `currently: ${current.name}` },
      { value: "role", label: "Role", hint: `currently: ${current.roleLabel}` },
      { value: "expertise", label: "Expertise level", hint: `currently: ${current.expertiseLabel}` },
      { value: "style", label: "Communication style", hint: `currently: ${current.styleLabel}` },
      { value: "workingOn", label: "What you're working on", hint: current.workingOn || "not set" },
      { value: "notes", label: "Notes", hint: current.notes ? current.notes.slice(0, 40) : "not set" },
    ],
  });
  if (p.isCancel(field)) return null;

  const updated = { ...current, updatedAt: new Date().toISOString().split("T")[0] };

  switch (field) {
    case "name": {
      const val = await p.text({ message: "New name", defaultValue: current.name });
      if (p.isCancel(val)) return null;
      updated.name = (val as string).trim();
      break;
    }
    case "role": {
      const val = await p.select({
        message: "New role",
        options: [
          { value: "developer", label: "Building things" },
          { value: "designer", label: "Designing things" },
          { value: "student", label: "Learning things" },
          { value: "manager", label: "Running things" },
          { value: "generalist", label: "A bit of everything" },
        ],
        initialValue: current.role,
      });
      if (p.isCancel(val)) return null;
      updated.role = val as UserIdentity["role"];
      const labels: Record<string, string> = { developer: "Developer / Engineer", designer: "Designer / Creative", student: "Student / Researcher", manager: "Lead / Manager", generalist: "Generalist" };
      updated.roleLabel = labels[val as string] || "Generalist";
      break;
    }
    case "expertise": {
      const val = await p.select({
        message: "New expertise level",
        options: [
          { value: "beginner", label: "Just getting started" },
          { value: "intermediate", label: "Know my way around" },
          { value: "advanced", label: "Been at it for years" },
          { value: "expert", label: "I wrote the book" },
        ],
        initialValue: current.expertise,
      });
      if (p.isCancel(val)) return null;
      updated.expertise = val as UserIdentity["expertise"];
      const labels: Record<string, string> = { beginner: "Getting Started", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };
      updated.expertiseLabel = labels[val as string] || "Intermediate";
      break;
    }
    case "style": {
      const val = await p.select({
        message: "New communication style",
        options: [
          { value: "concise", label: "Short and sharp" },
          { value: "balanced", label: "Balanced" },
          { value: "thorough", label: "Deep and detailed" },
          { value: "socratic", label: "Make me think" },
        ],
        initialValue: current.style,
      });
      if (p.isCancel(val)) return null;
      updated.style = val as UserIdentity["style"];
      const labels: Record<string, string> = { concise: "Concise — code first, talk later", balanced: "Balanced — explain and show", thorough: "Thorough — deep explanations", socratic: "Socratic — guide with questions" };
      updated.styleLabel = labels[val as string] || "Balanced";
      break;
    }
    case "workingOn": {
      const val = await p.text({ message: "What are you working on?", defaultValue: current.workingOn || "" });
      if (p.isCancel(val)) return null;
      updated.workingOn = (val as string).trim() || undefined;
      break;
    }
    case "notes": {
      const val = await p.text({ message: "Notes about you", defaultValue: current.notes || "" });
      if (p.isCancel(val)) return null;
      updated.notes = (val as string).trim() || undefined;
      break;
    }
  }

  saveUserIdentity(updated);
  p.log.success("Profile updated!");
  return updated;
}
