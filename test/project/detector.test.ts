import { describe, it, expect } from "vitest";
import {
  classifyProject,
  getRecommendedTemplate,
  getRecommendedProfiles,
  type ProjectType,
  type ProjectClassification,
} from "../../src/project/detector.js";
import type { StackProfile } from "../../src/dev/stack-detector.js";

function makeStack(overrides: Partial<StackProfile> = {}): StackProfile {
  return {
    projectName: "test-project",
    languages: [],
    frameworks: [],
    databases: [],
    infra: [],
    isMonorepo: false,
    detectedAt: Date.now(),
    ...overrides,
  };
}

describe("classifyProject", () => {
  it("detects web-frontend (react, no db)", () => {
    const stack = makeStack({ frameworks: ["react"], languages: ["typescript"] });
    const result = classifyProject(stack);
    expect(result.type).toBe("web-frontend");
    expect(result.confidence).toBe(0.85);
  });

  it("detects web-fullstack (next + postgresql)", () => {
    const stack = makeStack({
      frameworks: ["next", "react"],
      databases: ["postgresql"],
      languages: ["typescript"],
    });
    const result = classifyProject(stack);
    expect(result.type).toBe("web-fullstack");
    expect(result.confidence).toBe(0.9);
  });

  it("detects api-backend (express)", () => {
    const stack = makeStack({ frameworks: ["express"], languages: ["typescript"] });
    const result = classifyProject(stack);
    expect(result.type).toBe("api-backend");
    expect(result.confidence).toBe(0.9);
  });

  it("detects mobile (flutter/dart)", () => {
    const stack = makeStack({ frameworks: ["flutter"], languages: ["dart"] });
    const result = classifyProject(stack);
    expect(result.type).toBe("mobile");
    expect(result.confidence).toBe(0.9);
  });

  it("detects monorepo", () => {
    const stack = makeStack({ isMonorepo: true, languages: ["typescript"] });
    const result = classifyProject(stack);
    expect(result.type).toBe("monorepo");
    expect(result.confidence).toBe(0.9);
  });

  it("returns unknown for empty stack", () => {
    const stack = makeStack();
    const result = classifyProject(stack);
    expect(result.type).toBe("unknown");
    expect(result.confidence).toBe(0.3);
  });

  it("confidence is always between 0 and 1", () => {
    const stacks = [
      makeStack(),
      makeStack({ frameworks: ["react"] }),
      makeStack({ frameworks: ["next"], databases: ["postgresql"] }),
      makeStack({ frameworks: ["express"] }),
      makeStack({ frameworks: ["flutter"], languages: ["dart"] }),
      makeStack({ isMonorepo: true }),
      makeStack({ languages: ["python"] }),
    ];
    for (const stack of stacks) {
      const result = classifyProject(stack);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("getRecommendedTemplate", () => {
  it("returns correct template for each type", () => {
    const expectations: Record<ProjectType, string> = {
      "web-frontend": "full-feature",
      "web-fullstack": "full-feature",
      "api-backend": "full-feature",
      mobile: "full-feature",
      "cli-tool": "bug-fix",
      library: "full-feature",
      "ml-data": "full-feature",
      monorepo: "full-feature",
      unknown: "full-feature",
    };
    for (const [type, template] of Object.entries(expectations)) {
      expect(getRecommendedTemplate(type as ProjectType)).toBe(template);
    }
  });
});

describe("getRecommendedProfiles", () => {
  it("returns correct profiles for each type", () => {
    const expectations: Record<ProjectType, string[]> = {
      "web-frontend": ["architect", "coder", "tester", "reviewer"],
      "web-fullstack": ["architect", "coder", "security", "tester", "reviewer"],
      "api-backend": ["architect", "coder", "security", "tester", "reviewer"],
      mobile: ["architect", "coder", "tester", "reviewer"],
      "cli-tool": ["coder", "tester", "reviewer"],
      library: ["architect", "coder", "tester", "reviewer"],
      "ml-data": ["architect", "coder", "tester"],
      monorepo: ["architect", "coder", "security", "tester", "reviewer"],
      unknown: ["coder", "tester", "reviewer"],
    };
    for (const [type, profiles] of Object.entries(expectations)) {
      expect(getRecommendedProfiles(type as ProjectType)).toEqual(profiles);
    }
  });
});
