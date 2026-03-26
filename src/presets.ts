export type PresetName = "coding" | "creative" | "assistant" | "learning" | "minimal";

interface PresetRule {
  category: string;
  rule: string;
}

interface PresetWorkflow {
  name: string;
  description: string;
  steps: string[];
}

interface Preset {
  identity: { personality: string; style: string };
  rules: PresetRule[];
  workflows: PresetWorkflow[];
}

export const PRESETS: Record<PresetName, Preset> = {
  coding: {
    identity: {
      personality: "Direct, technical, concise. Shows code over explanation.",
      style: "Use short answers. Lead with the solution, explain after.",
    },
    rules: [
      { category: "response", rule: "Always show code examples, not just descriptions" },
      { category: "safety", rule: "Never execute destructive commands without confirmation" },
      { category: "quality", rule: "Follow project conventions over personal preference" },
    ],
    workflows: [
      { name: "debug", description: "Systematic debugging process", steps: ["Reproduce the issue", "Identify root cause", "Propose fix", "Verify fix"] },
    ],
  },
  creative: {
    identity: {
      personality: "Warm, imaginative, encouraging. Explores multiple angles.",
      style: "Use metaphors and vivid language. Ask 'what if' questions.",
    },
    rules: [
      { category: "response", rule: "Always offer 2-3 alternative approaches" },
      { category: "tone", rule: "Encourage experimentation, never dismiss ideas" },
    ],
    workflows: [
      { name: "brainstorm", description: "Creative brainstorming process", steps: ["Explore the problem space", "Generate 5+ ideas", "Evaluate trade-offs", "Refine top 2"] },
    ],
  },
  assistant: {
    identity: {
      personality: "Organized, proactive, action-oriented.",
      style: "Use bullet points and checklists. Summarize key takeaways.",
    },
    rules: [
      { category: "response", rule: "End responses with clear next steps when applicable" },
      { category: "memory", rule: "Always track deadlines and commitments mentioned" },
    ],
    workflows: [
      { name: "plan", description: "Task planning process", steps: ["Clarify the goal", "Break into tasks", "Prioritize", "Set deadlines"] },
    ],
  },
  learning: {
    identity: {
      personality: "Patient, curious, Socratic. Builds understanding layer by layer.",
      style: "Use analogies. Check understanding before moving on.",
    },
    rules: [
      { category: "response", rule: "Explain concepts before showing solutions" },
      { category: "teaching", rule: "Ask a follow-up question to reinforce learning" },
    ],
    workflows: [],
  },
  minimal: {
    identity: {
      personality: "Helpful and adaptive. Matches the user's tone and needs.",
      style: "Clear and concise. Prioritizes usefulness over verbosity.",
    },
    rules: [],
    workflows: [],
  },
};

interface PresetResult {
  coreMd: string;
  rulesMd: string | null;
  flowMd: string | null;
}

export function applyPreset(name: PresetName, companionName: string): PresetResult {
  const preset = PRESETS[name];

  const coreMd = [
    `# ${companionName}`,
    "",
    "## Personality",
    preset.identity.personality,
    "",
    "## Style",
    preset.identity.style,
    "",
    "## Session",
    "_New companion — no prior sessions._",
  ].join("\n");

  let rulesMd: string | null = null;
  if (preset.rules.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const r of preset.rules) {
      if (!grouped.has(r.category)) grouped.set(r.category, []);
      grouped.get(r.category)!.push(r.rule);
    }
    const sections = [...grouped.entries()]
      .map(([cat, rules]) => `## ${cat}\n${rules.map((r) => `- ${r}`).join("\n")}`)
      .join("\n\n");
    rulesMd = `# Guardrails\n\n${sections}`;
  }

  let flowMd: string | null = null;
  if (preset.workflows.length > 0) {
    const wfSections = preset.workflows
      .map((wf) => {
        const steps = wf.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
        return `## ${wf.name}\n${wf.description}\n\n${steps}`;
      })
      .join("\n\n");
    flowMd = `# Workflows\n\n${wfSections}`;
  }

  return { coreMd, rulesMd, flowMd };
}
