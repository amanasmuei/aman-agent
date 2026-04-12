import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { getOrchestratorProfile, ORCHESTRATOR_PROFILES } from "./orchestrator-profiles.js";

/**
 * Check if an orchestrator profile is installed.
 * A profile is considered installed if {profilesDir}/{profileName}/core.md exists.
 */
export function isProfileInstalled(profileName: string, profilesDir: string): boolean {
  return fs.existsSync(path.join(profilesDir, profileName, "core.md"));
}

/**
 * Install a single orchestrator profile.
 * Gets the profile from getOrchestratorProfile(), creates the directory,
 * writes core.md and optionally rules.md.
 *
 * @returns true if installed, false if profile not found
 */
export function installProfile(profileName: string, profilesDir: string): boolean {
  const profile = getOrchestratorProfile(profileName);
  if (!profile) return false;

  const profileDir = path.join(profilesDir, profileName);
  fs.mkdirSync(profileDir, { recursive: true });

  fs.writeFileSync(path.join(profileDir, "core.md"), profile.core, "utf-8");

  if (profile.rules) {
    fs.writeFileSync(path.join(profileDir, "rules.md"), profile.rules, "utf-8");
  }

  return true;
}

/**
 * Ensure all orchestrator profiles are installed.
 * Skips profiles that already have core.md present.
 *
 * @returns summary of which profiles were installed vs skipped
 */
export function ensureAllProfilesInstalled(profilesDir: string): {
  installed: string[];
  skipped: string[];
} {
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const profile of ORCHESTRATOR_PROFILES) {
    if (isProfileInstalled(profile.name, profilesDir)) {
      skipped.push(profile.name);
    } else {
      installProfile(profile.name, profilesDir);
      installed.push(profile.name);
    }
  }

  return { installed, skipped };
}

/**
 * Auto-install a profile if it's an orchestrator profile and not yet installed.
 * Call this before delegation.
 *
 * @returns true if profile is now ready (already was or just installed)
 * @returns false if it's not a known orchestrator profile
 */
export function ensureProfileReady(profileName: string, profilesDir: string): boolean {
  const profile = getOrchestratorProfile(profileName);
  if (!profile) return false;

  if (!isProfileInstalled(profileName, profilesDir)) {
    installProfile(profileName, profilesDir);
  }

  return true;
}

/**
 * Get the default profiles directory.
 * Respects ACORE_HOME env var, otherwise uses ~/.acore/profiles.
 */
export function getProfilesDir(): string {
  const acoreHome = process.env.ACORE_HOME;
  if (acoreHome) {
    return path.join(acoreHome, "profiles");
  }
  return path.join(os.homedir(), ".acore", "profiles");
}
