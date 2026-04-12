import { describe, it, expect } from "vitest";
import { BUILT_IN_PROFILES } from "../../src/profile-templates.js";
import { getOrchestratorProfile, getOrchestratorProfileNames } from "../../src/profiles/orchestrator-profiles.js";

describe("profile integration", () => {
  it("BUILT_IN_PROFILES includes all 7 profiles", () => {
    expect(BUILT_IN_PROFILES.length).toBe(7);
  });

  it("BUILT_IN_PROFILES includes orchestrator profiles", () => {
    const names = BUILT_IN_PROFILES.map((p) => p.name);
    expect(names).toContain("architect");
    expect(names).toContain("security");
    expect(names).toContain("tester");
    expect(names).toContain("reviewer");
  });

  it("BUILT_IN_PROFILES preserves original profiles", () => {
    const names = BUILT_IN_PROFILES.map((p) => p.name);
    expect(names).toContain("coder");
    expect(names).toContain("writer");
    expect(names).toContain("researcher");
  });

  it("all profiles have unique names", () => {
    const names = BUILT_IN_PROFILES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("orchestrator profiles are accessible by name", () => {
    expect(getOrchestratorProfile("architect")).toBeDefined();
    expect(getOrchestratorProfile("security")).toBeDefined();
    expect(getOrchestratorProfile("tester")).toBeDefined();
    expect(getOrchestratorProfile("reviewer")).toBeDefined();
  });
});
