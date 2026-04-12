import { describe, it, expect } from "vitest";
import {
  ORCHESTRATOR_PROFILES,
  architectProfile,
  securityProfile,
  testerProfile,
  reviewerProfile,
  getOrchestratorProfile,
  getOrchestratorProfileNames,
} from "../../src/profiles/orchestrator-profiles.js";
import type { ProfileTemplate } from "../../src/profile-templates.js";

describe("ORCHESTRATOR_PROFILES", () => {
  it("has exactly 4 profiles", () => {
    expect(ORCHESTRATOR_PROFILES).toHaveLength(4);
  });

  it("each profile has required fields (name, label, description, core)", () => {
    for (const profile of ORCHESTRATOR_PROFILES) {
      expect(profile.name).toBeTruthy();
      expect(profile.label).toBeTruthy();
      expect(profile.description).toBeTruthy();
      expect(profile.core).toBeTruthy();
    }
  });

  it("each profile has rules defined", () => {
    for (const profile of ORCHESTRATOR_PROFILES) {
      expect(profile.rules).toBeTruthy();
    }
  });

  it("profile names are unique", () => {
    const names = ORCHESTRATOR_PROFILES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("profile names match expected set: architect, security, tester, reviewer", () => {
    const names = ORCHESTRATOR_PROFILES.map((p) => p.name).sort();
    expect(names).toEqual(["architect", "reviewer", "security", "tester"]);
  });
});

describe("getOrchestratorProfile", () => {
  it("returns correct profile by name", () => {
    const architect = getOrchestratorProfile("architect");
    expect(architect).toBeDefined();
    expect(architect!.name).toBe("architect");
    expect(architect!.label).toBe("System Architect");

    const security = getOrchestratorProfile("security");
    expect(security).toBeDefined();
    expect(security!.name).toBe("security");

    const tester = getOrchestratorProfile("tester");
    expect(tester).toBeDefined();
    expect(tester!.name).toBe("tester");

    const reviewer = getOrchestratorProfile("reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer!.name).toBe("reviewer");
  });

  it("returns undefined for unknown name", () => {
    expect(getOrchestratorProfile("unknown")).toBeUndefined();
    expect(getOrchestratorProfile("")).toBeUndefined();
  });
});

describe("getOrchestratorProfileNames", () => {
  it("returns all 4 names", () => {
    const names = getOrchestratorProfileNames();
    expect(names).toHaveLength(4);
    expect(names).toContain("architect");
    expect(names).toContain("security");
    expect(names).toContain("tester");
    expect(names).toContain("reviewer");
  });
});

describe("individual profile exports", () => {
  it("exports architectProfile with correct shape", () => {
    expect(architectProfile.name).toBe("architect");
    expect(architectProfile.label).toBe("System Architect");
  });

  it("exports securityProfile with correct shape", () => {
    expect(securityProfile.name).toBe("security");
    expect(securityProfile.label).toBe("Security Analyst");
  });

  it("exports testerProfile with correct shape", () => {
    expect(testerProfile.name).toBe("tester");
    expect(testerProfile.label).toBe("Test Engineer");
  });

  it("exports reviewerProfile with correct shape", () => {
    expect(reviewerProfile.name).toBe("reviewer");
    expect(reviewerProfile.label).toBe("Code Reviewer");
  });
});
