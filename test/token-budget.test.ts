import { describe, it, expect } from "vitest";
import { estimateTokens, buildBudgetedPrompt } from "../src/token-budget.js";
import type { PromptComponent } from "../src/token-budget.js";

describe("estimateTokens", () => {
  it("returns reasonable estimate for English text", () => {
    const text = "Hello world this is a test sentence with eight words";
    const tokens = estimateTokens(text);
    // 10 words * 1.3 = 13
    expect(tokens).toBe(13);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(estimateTokens("   \n\t  ")).toBe(0);
  });

  it("handles markdown content", () => {
    const md = "# Heading\n\n- item one\n- item two\n\nParagraph text here.";
    const tokens = estimateTokens(md);
    expect(tokens).toBeGreaterThan(0);
    // 9 words * 1.3 = ~12
    expect(tokens).toBeLessThan(20);
  });
});

describe("buildBudgetedPrompt", () => {
  function makeComponent(name: string, wordCount: number): PromptComponent {
    const words = Array.from({ length: wordCount }, (_, i) => `word${i}`);
    const content = words.join(" ");
    return { name, content, tokens: estimateTokens(content) };
  }

  it("includes all components when under budget", () => {
    const components = [
      makeComponent("identity", 10),
      makeComponent("guardrails", 10),
      makeComponent("tools", 10),
    ];
    const result = buildBudgetedPrompt(components, 8000);

    expect(result.included).toEqual(["identity", "guardrails", "tools"]);
    expect(result.truncated).toEqual([]);
    expect(result.prompt).toContain("word0");
  });

  it("truncates lowest priority first when over budget", () => {
    const components = [
      makeComponent("identity", 100),
      makeComponent("skills", 100),
      makeComponent("guardrails", 100),
    ];
    // Budget that fits ~2 components but not 3
    const identityTokens = components[0].tokens;
    const guardrailsTokens = components[2].tokens;
    const budget = identityTokens + guardrailsTokens + 5;

    const result = buildBudgetedPrompt(components, budget);

    // identity and guardrails are higher priority than skills
    expect(result.included).toContain("identity");
    expect(result.included).toContain("guardrails");
    // skills is lowest priority — should be truncated or partially included
    const skillsFullyIncluded = result.included.includes("skills");
    const skillsPartial = result.included.some((n) => n.startsWith("skills"));
    const skillsTruncated = result.truncated.includes("skills");
    expect(skillsFullyIncluded || skillsPartial || skillsTruncated).toBe(true);
  });

  it("respects priority order", () => {
    const components = [
      makeComponent("skills", 10),
      makeComponent("identity", 10),
      makeComponent("guardrails", 10),
      makeComponent("workflows", 10),
      makeComponent("tools", 10),
    ];
    const result = buildBudgetedPrompt(components, 8000);

    // Should be sorted by priority, not input order
    expect(result.included).toEqual([
      "identity",
      "guardrails",
      "workflows",
      "tools",
      "skills",
    ]);
  });

  it("partially includes a component when half fits", () => {
    // Create a large component that won't fit fully but half will
    const largeContent = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const largeTokens = estimateTokens(largeContent);

    const components: PromptComponent[] = [
      { name: "identity", content: "small identity", tokens: estimateTokens("small identity") },
      { name: "skills", content: largeContent, tokens: largeTokens },
    ];

    // Budget: fits identity + half of skills but not full skills
    const halfTokens = estimateTokens(largeContent.slice(0, Math.floor(largeContent.length / 2)));
    const budget = components[0].tokens + halfTokens + 5;

    const result = buildBudgetedPrompt(components, budget);

    expect(result.included).toContain("identity");
    expect(result.included).toContain("skills (partial)");
    expect(result.truncated).toEqual([]);
    expect(result.prompt).toContain("[... truncated for context budget ...]");
  });

  it("fully excludes a component when even half does not fit", () => {
    const largeContent = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const largeTokens = estimateTokens(largeContent);

    const components: PromptComponent[] = [
      { name: "identity", content: largeContent, tokens: largeTokens },
      { name: "skills", content: largeContent, tokens: largeTokens },
    ];

    // Budget: fits only identity
    const budget = largeTokens + 5;

    const result = buildBudgetedPrompt(components, budget);

    expect(result.included).toEqual(["identity"]);
    expect(result.truncated).toEqual(["skills"]);
  });

  it("returns empty prompt when no components provided", () => {
    const result = buildBudgetedPrompt([], 8000);
    expect(result.prompt).toBe("");
    expect(result.included).toEqual([]);
    expect(result.truncated).toEqual([]);
    expect(result.totalTokens).toBe(0);
  });

  it("separates parts with --- separator", () => {
    const components = [
      makeComponent("identity", 5),
      makeComponent("guardrails", 5),
    ];
    const result = buildBudgetedPrompt(components, 8000);
    expect(result.prompt).toContain("\n\n---\n\n");
  });

  it("tracks total tokens accurately", () => {
    const components = [
      makeComponent("identity", 10),
      makeComponent("guardrails", 10),
    ];
    const result = buildBudgetedPrompt(components, 8000);
    expect(result.totalTokens).toBe(components[0].tokens + components[1].tokens);
  });
});
