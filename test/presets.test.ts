import { describe, it, expect } from "vitest";
import { PRESETS, type PresetName, applyPreset } from "../src/presets.js";

describe("presets", () => {
  it("exports all 5 preset names", () => {
    const names: PresetName[] = ["coding", "creative", "assistant", "learning", "minimal"];
    for (const name of names) {
      expect(PRESETS[name]).toBeDefined();
    }
  });

  it("every preset has identity with personality and style", () => {
    for (const [, preset] of Object.entries(PRESETS)) {
      expect(preset.identity.personality).toBeTruthy();
      expect(preset.identity.style).toBeTruthy();
    }
  });

  it("coding preset has rules and workflows", () => {
    expect(PRESETS.coding.rules.length).toBeGreaterThan(0);
    expect(PRESETS.coding.workflows.length).toBeGreaterThan(0);
  });

  it("minimal preset has no rules or workflows", () => {
    expect(PRESETS.minimal.rules).toHaveLength(0);
    expect(PRESETS.minimal.workflows).toHaveLength(0);
  });

  it("applyPreset generates valid core.md content", () => {
    const result = applyPreset("coding", "TestBot");
    expect(result.coreMd).toContain("# TestBot");
    expect(result.coreMd).toContain("## Personality");
    expect(result.coreMd).toContain("## Style");
  });

  it("applyPreset generates valid rules.md content when rules exist", () => {
    const result = applyPreset("coding", "TestBot");
    expect(result.rulesMd).toContain("# Guardrails");
    expect(result.rulesMd).toBeTruthy();
  });

  it("applyPreset generates valid flow.md content when workflows exist", () => {
    const result = applyPreset("coding", "TestBot");
    expect(result.flowMd).toContain("# Workflows");
  });

  it("applyPreset returns null flow.md for presets without workflows", () => {
    const result = applyPreset("minimal", "TestBot");
    expect(result.flowMd).toBeNull();
  });

  it("uses provided name in heading", () => {
    const result = applyPreset("minimal", "Aman");
    expect(result.coreMd).toContain("# Aman");
  });
});
