import type { StackProfile } from "../dev/stack-detector.js";

export type ProjectType =
  | "web-frontend"
  | "web-fullstack"
  | "api-backend"
  | "mobile"
  | "cli-tool"
  | "library"
  | "ml-data"
  | "monorepo"
  | "unknown";

export interface ProjectClassification {
  type: ProjectType;
  confidence: number;
  suggestedTemplate: string;
  suggestedProfiles: string[];
  description: string;
}

const FRONTEND_FRAMEWORKS = new Set(["react", "vue", "svelte"]);
const FULLSTACK_FRAMEWORKS = new Set(["next", "nuxt", "remix"]);
const BACKEND_FRAMEWORKS = new Set([
  "express", "fastify", "hono", "nestjs",
  "fiber", "gin", "chi", "echo",
  "fastapi", "django", "flask",
]);
const ML_FRAMEWORKS = new Set(["torch", "tensorflow", "sklearn", "pytorch", "pandas", "numpy"]);
const WEB_FRAMEWORKS = new Set([
  ...FRONTEND_FRAMEWORKS, ...FULLSTACK_FRAMEWORKS, ...BACKEND_FRAMEWORKS,
]);

const TEMPLATE_MAP: Record<ProjectType, string> = {
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

const PROFILE_MAP: Record<ProjectType, string[]> = {
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

const DESCRIPTION_MAP: Record<ProjectType, string> = {
  "web-frontend": "Frontend web application",
  "web-fullstack": "Full-stack web application with database",
  "api-backend": "API/backend service",
  mobile: "Mobile application",
  "cli-tool": "Command-line tool",
  library: "Reusable library/package",
  "ml-data": "Machine learning / data science project",
  monorepo: "Monorepo with multiple packages",
  unknown: "Unknown project type",
};

function hasAny(items: string[], set: Set<string>): boolean {
  return items.some((i) => set.has(i));
}

export function classifyProject(stack: StackProfile): ProjectClassification {
  let type: ProjectType;
  let confidence: number;

  if (stack.isMonorepo) {
    type = "monorepo";
    confidence = 0.9;
  } else if (hasAny(stack.frameworks, new Set(["flutter"])) || stack.languages.includes("dart")) {
    type = "mobile";
    confidence = 0.9;
  } else if (hasAny(stack.frameworks, FULLSTACK_FRAMEWORKS) && stack.databases.length > 0) {
    type = "web-fullstack";
    confidence = 0.9;
  } else if (hasAny(stack.frameworks, BACKEND_FRAMEWORKS)) {
    type = "api-backend";
    confidence = 0.9;
  } else if (hasAny(stack.frameworks, FRONTEND_FRAMEWORKS)) {
    type = "web-frontend";
    confidence = 0.85;
  } else if (stack.languages.includes("python") && !hasAny(stack.frameworks, WEB_FRAMEWORKS)) {
    if (hasAny(stack.frameworks, ML_FRAMEWORKS)) {
      type = "ml-data";
      confidence = 0.8;
    } else {
      type = "cli-tool";
      confidence = 0.6;
    }
  } else if (stack.languages.length > 0 && stack.frameworks.length === 0) {
    type = "library";
    confidence = 0.6;
  } else if (stack.languages.length === 0 && stack.frameworks.length === 0) {
    type = "unknown";
    confidence = 0.3;
  } else {
    type = "unknown";
    confidence = 0.3;
  }

  return {
    type,
    confidence,
    suggestedTemplate: TEMPLATE_MAP[type],
    suggestedProfiles: PROFILE_MAP[type],
    description: DESCRIPTION_MAP[type],
  };
}

export function getRecommendedTemplate(type: ProjectType): string {
  return TEMPLATE_MAP[type] ?? TEMPLATE_MAP.unknown;
}

export function getRecommendedProfiles(type: ProjectType): string[] {
  return PROFILE_MAP[type] ?? PROFILE_MAP.unknown;
}
