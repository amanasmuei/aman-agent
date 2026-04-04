import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface UserIdentity {
  name: string;
  role: "developer" | "designer" | "student" | "manager" | "generalist";
  roleLabel: string;
  expertise: "beginner" | "intermediate" | "advanced" | "expert";
  expertiseLabel: string;
  style: "concise" | "balanced" | "thorough" | "socratic";
  styleLabel: string;
  workingOn?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

const USER_FILE = path.join(os.homedir(), ".acore", "user.md");

/**
 * Check if user identity exists.
 */
export function hasUserIdentity(): boolean {
  return fs.existsSync(USER_FILE);
}

/**
 * Load user identity from ~/.acore/user.md.
 * Returns null if file doesn't exist or is malformed.
 */
export function loadUserIdentity(): UserIdentity | null {
  if (!fs.existsSync(USER_FILE)) return null;

  try {
    const content = fs.readFileSync(USER_FILE, "utf-8");

    const get = (key: string): string => {
      const match = content.match(new RegExp(`^- ${key}:\\s*(.+)$`, "m"));
      return match?.[1]?.trim() ?? "";
    };

    const getSection = (heading: string): string => {
      const pattern = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
      const match = content.match(pattern);
      if (!match) return "";
      // Strip leading "- Key: value" lines, return freeform text
      return match[1]
        .split("\n")
        .filter((line) => !line.startsWith("- ") && line.trim().length > 0)
        .join("\n")
        .trim();
    };

    const name = get("Name");
    if (!name) return null;

    return {
      name,
      role: (get("Role") || "generalist") as UserIdentity["role"],
      roleLabel: get("Role Label") || get("Role") || "Generalist",
      expertise: (get("Expertise") || "intermediate") as UserIdentity["expertise"],
      expertiseLabel: get("Expertise Label") || get("Expertise") || "Intermediate",
      style: (get("Style") || "balanced") as UserIdentity["style"],
      styleLabel: get("Style Label") || get("Style") || "Balanced",
      workingOn: getSection("Working On") || undefined,
      notes: getSection("Notes") || undefined,
      createdAt: get("Created") || new Date().toISOString().split("T")[0],
      updatedAt: get("Updated") || new Date().toISOString().split("T")[0],
    };
  } catch {
    return null;
  }
}

/**
 * Save user identity to ~/.acore/user.md.
 */
export function saveUserIdentity(user: UserIdentity): void {
  const dir = path.dirname(USER_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const lines: string[] = [
    "# User Profile",
    "",
    "## About",
    `- Name: ${user.name}`,
    `- Role: ${user.role}`,
    `- Role Label: ${user.roleLabel}`,
    `- Expertise: ${user.expertise}`,
    `- Expertise Label: ${user.expertiseLabel}`,
    `- Style: ${user.style}`,
    `- Style Label: ${user.styleLabel}`,
  ];

  if (user.workingOn) {
    lines.push("", "## Working On", user.workingOn);
  }

  if (user.notes) {
    lines.push("", "## Notes", user.notes);
  }

  lines.push(
    "",
    "## Meta",
    `- Created: ${user.createdAt}`,
    `- Updated: ${user.updatedAt}`,
  );

  fs.writeFileSync(USER_FILE, lines.join("\n") + "\n", "utf-8");
}

/**
 * Format user identity for injection into system prompt.
 */
export function formatUserContext(user: UserIdentity): string {
  const parts: string[] = [
    `<user-profile>`,
    `The person you're talking to:`,
    `- Name: ${user.name}`,
    `- Role: ${user.roleLabel}`,
    `- Expertise: ${user.expertiseLabel}`,
  ];

  // Style instructions
  switch (user.style) {
    case "concise":
      parts.push("- Prefers: short, direct answers. Code first, explain after. No fluff.");
      break;
    case "balanced":
      parts.push("- Prefers: explain the reasoning briefly, then show the solution.");
      break;
    case "thorough":
      parts.push("- Prefers: detailed explanations with context. Help them understand deeply.");
      break;
    case "socratic":
      parts.push("- Prefers: ask guiding questions. Help them figure it out themselves.");
      break;
  }

  // Expertise calibration
  switch (user.expertise) {
    case "beginner":
      parts.push("- Calibration: explain concepts clearly, define terms, show examples. Be patient.");
      break;
    case "intermediate":
      parts.push("- Calibration: skip basic explanations, focus on the task. Explain non-obvious things.");
      break;
    case "advanced":
      parts.push("- Calibration: be direct. Skip explanations unless asked. Focus on edge cases and trade-offs.");
      break;
    case "expert":
      parts.push("- Calibration: peer-level discussion. Challenge assumptions. Focus on architecture and nuance.");
      break;
  }

  if (user.workingOn) {
    parts.push(`- Currently working on: ${user.workingOn}`);
  }

  if (user.notes) {
    parts.push(`- Notes: ${user.notes}`);
  }

  parts.push(
    "",
    `Use their name naturally (not every message). Adapt to their level and style.`,
    `</user-profile>`,
  );

  return parts.join("\n");
}
