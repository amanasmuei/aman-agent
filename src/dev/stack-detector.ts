import fs from "node:fs";
import path from "node:path";

export interface StackProfile {
  projectName: string;
  languages: string[];
  frameworks: string[];
  databases: string[];
  infra: string[];
  isMonorepo: boolean;
  detectedAt: number;
}

const FRAMEWORK_MAP: Record<string, string> = {
  next: "next", react: "react", remix: "remix", express: "express",
  fastify: "fastify", hono: "hono", "@nestjs/core": "nestjs",
  vue: "vue", svelte: "svelte", nuxt: "nuxt",
};

const DB_IMAGE_MAP: Record<string, string> = {
  postgres: "postgresql", mysql: "mysql", mariadb: "mariadb",
  mongo: "mongodb", redis: "redis", timescaledb: "timescaledb",
};

export function scanStack(projectPath: string): StackProfile {
  const languages: string[] = [];
  const frameworks: string[] = [];
  const databases: string[] = [];
  const infra: string[] = [];
  let isMonorepo = false;
  let projectName = path.basename(projectPath);

  // --- Go ---
  const goModPath = path.join(projectPath, "go.mod");
  if (fs.existsSync(goModPath)) {
    languages.push("go");
    const content = fs.readFileSync(goModPath, "utf-8");
    const moduleMatch = content.match(/^module\s+(.+)$/m);
    if (moduleMatch) {
      const parts = moduleMatch[1].trim().split("/");
      projectName = parts[parts.length - 1];
    }
    if (content.includes("gofiber/fiber")) frameworks.push("fiber");
    if (content.includes("gin-gonic/gin")) frameworks.push("gin");
    if (content.includes("go-chi/chi")) frameworks.push("chi");
    if (content.includes("labstack/echo")) frameworks.push("echo");
  }

  // --- Node/TypeScript ---
  const pkgPath = path.join(projectPath, "package.json");
  const hasTsConfig = fs.existsSync(path.join(projectPath, "tsconfig.json"));
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.name) projectName = pkg.name;
      if (hasTsConfig) {
        languages.push("typescript");
      } else {
        languages.push("javascript");
      }
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, fwName] of Object.entries(FRAMEWORK_MAP)) {
        if (allDeps?.[dep]) frameworks.push(fwName);
      }
      if (pkg.workspaces) isMonorepo = true;
    } catch {
      if (hasTsConfig) languages.push("typescript");
    }
  } else if (hasTsConfig) {
    languages.push("typescript");
  }

  // --- Rust ---
  const cargoPath = path.join(projectPath, "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    languages.push("rust");
    const content = fs.readFileSync(cargoPath, "utf-8");
    if (content.includes("[workspace]")) isMonorepo = true;
    const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (nameMatch && !isMonorepo) projectName = nameMatch[1];
  }

  // --- Python ---
  const pyprojectPath = path.join(projectPath, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    languages.push("python");
    const content = fs.readFileSync(pyprojectPath, "utf-8");
    if (content.includes("django")) frameworks.push("django");
    if (content.includes("fastapi")) frameworks.push("fastapi");
    if (content.includes("flask")) frameworks.push("flask");
  }

  // --- Flutter/Dart ---
  if (fs.existsSync(path.join(projectPath, "pubspec.yaml"))) {
    languages.push("dart");
    frameworks.push("flutter");
  }

  // --- Docker ---
  if (fs.existsSync(path.join(projectPath, "Dockerfile"))) {
    infra.push("docker");
  }

  // --- Docker Compose (databases) ---
  const composeNames = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
  for (const name of composeNames) {
    const composePath = path.join(projectPath, name);
    if (fs.existsSync(composePath)) {
      if (!infra.includes("docker")) infra.push("docker");
      const content = fs.readFileSync(composePath, "utf-8");
      for (const [pattern, dbName] of Object.entries(DB_IMAGE_MAP)) {
        if (content.includes(pattern) && !databases.includes(dbName)) {
          databases.push(dbName);
        }
      }
      break;
    }
  }

  // --- CI/CD ---
  if (fs.existsSync(path.join(projectPath, ".github", "workflows"))) {
    infra.push("github-actions");
  }

  // --- Kubernetes ---
  for (const dir of ["k3s", "k8s", "deploy"]) {
    if (fs.existsSync(path.join(projectPath, dir))) {
      infra.push("kubernetes");
      break;
    }
  }

  // --- Makefile ---
  if (fs.existsSync(path.join(projectPath, "Makefile"))) {
    infra.push("make");
  }

  return {
    projectName,
    languages,
    frameworks,
    databases,
    infra,
    isMonorepo,
    detectedAt: Date.now(),
  };
}
