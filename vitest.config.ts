import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude worktrees and standard ignores. `.worktrees/` is a
    // developer convention (see superpowers:using-git-worktrees) for
    // isolated feature branches; its tests would otherwise be picked
    // up by vitest's default glob and cause duplicate runs.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.worktrees/**",
      "**/.git/**",
    ],
  },
});
