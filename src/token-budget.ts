// Rough token estimation: ~1.3 tokens per word for English markdown
export function estimateTokens(text: string): number {
  return Math.round(text.split(/\s+/).filter(Boolean).length * 1.3);
}

// Priority order for system prompt components (highest to lowest)
const PRIORITIES = [
  "identity",    // core.md — always include
  "guardrails",  // rules.md — safety critical
  "workflows",   // flow.md — behavioral
  "tools",       // kit.md — capabilities
  "skills",      // skills.md — can be truncated
];

export interface PromptComponent {
  name: string;
  content: string;
  tokens: number;
}

export function buildBudgetedPrompt(
  components: PromptComponent[],
  maxTokens: number = 8000, // default budget for system prompt
): { prompt: string; included: string[]; truncated: string[]; totalTokens: number } {
  const included: string[] = [];
  const truncated: string[] = [];
  const parts: string[] = [];
  let totalTokens = 0;

  // Sort by priority
  const sorted = [...components].sort((a, b) => {
    const aPri = PRIORITIES.indexOf(a.name);
    const bPri = PRIORITIES.indexOf(b.name);
    return (aPri === -1 ? 99 : aPri) - (bPri === -1 ? 99 : bPri);
  });

  for (const comp of sorted) {
    if (totalTokens + comp.tokens <= maxTokens) {
      parts.push(comp.content);
      included.push(comp.name);
      totalTokens += comp.tokens;
    } else {
      // Try to include a truncated version (first 50% of content)
      const halfContent = comp.content.slice(0, Math.floor(comp.content.length / 2));
      const halfTokens = estimateTokens(halfContent);
      if (totalTokens + halfTokens <= maxTokens) {
        parts.push(halfContent + "\n\n[... truncated for context budget ...]");
        included.push(comp.name + " (partial)");
        totalTokens += halfTokens;
      } else {
        truncated.push(comp.name);
      }
    }
  }

  return {
    prompt: parts.join("\n\n---\n\n"),
    included,
    truncated,
    totalTokens,
  };
}
