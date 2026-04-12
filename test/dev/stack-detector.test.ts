import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanStack, type StackProfile } from "../../src/dev/stack-detector.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `stack-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scanStack", () => {
  it("returns empty profile for empty directory", () => {
    const profile = scanStack(tmpDir);
    expect(profile.projectName).toBe(path.basename(tmpDir));
    expect(profile.languages).toEqual([]);
    expect(profile.frameworks).toEqual([]);
    expect(profile.databases).toEqual([]);
    expect(profile.infra).toEqual([]);
    expect(profile.isMonorepo).toBe(false);
    expect(typeof profile.detectedAt).toBe("number");
  });

  it("detects Go from go.mod", () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module github.com/user/myapp\n\ngo 1.22\n");
    const profile = scanStack(tmpDir);
    expect(profile.languages).toContain("go");
    expect(profile.projectName).toBe("myapp");
  });

  it("detects TypeScript from tsconfig.json + package.json", () => {
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      name: "my-ts-app",
      dependencies: { "next": "^14.0.0" },
    }));
    const profile = scanStack(tmpDir);
    expect(profile.languages).toContain("typescript");
    expect(profile.frameworks).toContain("next");
    expect(profile.projectName).toBe("my-ts-app");
  });

  it("detects Rust from Cargo.toml", () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), '[package]\nname = "my-crate"\nversion = "0.1.0"\n');
    const profile = scanStack(tmpDir);
    expect(profile.languages).toContain("rust");
  });

  it("detects Rust workspace as monorepo", () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), '[workspace]\nmembers = ["crate-a", "crate-b"]\n');
    const profile = scanStack(tmpDir);
    expect(profile.languages).toContain("rust");
    expect(profile.isMonorepo).toBe(true);
  });

  it("detects Python from pyproject.toml", () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), '[project]\nname = "myapp"\n');
    const profile = scanStack(tmpDir);
    expect(profile.languages).toContain("python");
  });

  it("detects Flutter from pubspec.yaml", () => {
    fs.writeFileSync(path.join(tmpDir, "pubspec.yaml"), "name: myapp\n");
    const profile = scanStack(tmpDir);
    expect(profile.languages).toContain("dart");
    expect(profile.frameworks).toContain("flutter");
  });

  it("detects Node.js without TypeScript", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      name: "my-node-app",
      dependencies: { "express": "^4.18.0" },
    }));
    const profile = scanStack(tmpDir);
    expect(profile.languages).toContain("javascript");
    expect(profile.frameworks).toContain("express");
  });

  it("detects Docker infra", () => {
    fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM node:20\n");
    const profile = scanStack(tmpDir);
    expect(profile.infra).toContain("docker");
  });

  it("detects GitHub Actions CI", () => {
    fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".github", "workflows", "ci.yml"), "name: CI\n");
    const profile = scanStack(tmpDir);
    expect(profile.infra).toContain("github-actions");
  });

  it("detects databases from docker-compose.yml", () => {
    fs.writeFileSync(path.join(tmpDir, "docker-compose.yml"), `
services:
  db:
    image: postgres:16
  cache:
    image: redis:7
`);
    const profile = scanStack(tmpDir);
    expect(profile.databases).toContain("postgresql");
    expect(profile.databases).toContain("redis");
  });

  it("detects Kubernetes infra", () => {
    fs.mkdirSync(path.join(tmpDir, "k8s"), { recursive: true });
    const profile = scanStack(tmpDir);
    expect(profile.infra).toContain("kubernetes");
  });

  it("detects multiple languages in one project", () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module github.com/user/app\n\ngo 1.22\n");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "app" }));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}");
    const profile = scanStack(tmpDir);
    expect(profile.languages).toContain("go");
    expect(profile.languages).toContain("typescript");
  });

  it("detects Go Fiber framework from go.mod", () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), `module github.com/user/app

go 1.22

require github.com/gofiber/fiber/v2 v2.52.0
`);
    const profile = scanStack(tmpDir);
    expect(profile.frameworks).toContain("fiber");
  });
});
