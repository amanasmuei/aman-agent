import { describe, it, expect } from "vitest";
import { formatThreadSurfaceMessage } from "../src/workspaces/thread-bridge.js";

describe("formatThreadSurfaceMessage", () => {
  it("returns a workspace-only line when no active thread", () => {
    const msg = formatThreadSurfaceMessage({
      workspaceName: "aman-mcp",
      activeThread: null,
      cwdMatchesThreadWorkspaces: false,
    });
    expect(msg).toContain("aman-mcp");
    expect(msg).not.toContain("thread");
  });

  it("anchors inline when cwd is in the active thread's workspaces", () => {
    const msg = formatThreadSurfaceMessage({
      workspaceName: "aman-mcp",
      activeThread: {
        id: "01KS3F29B92X3TFNDG30HJR4D1",
        name: "Phase 1.5 substrate",
      },
      cwdMatchesThreadWorkspaces: true,
    });
    expect(msg).toContain("aman-mcp");
    expect(msg).toContain("Phase 1.5 substrate");
    expect(msg).toMatch(/part of|workspace.*for/i);
  });

  it("surfaces softly when there is an active thread but cwd doesn't match", () => {
    const msg = formatThreadSurfaceMessage({
      workspaceName: "scratch-repo",
      activeThread: {
        id: "01KS3F29B92X3TFNDG30HJR4D1",
        name: "Phase 1.5 substrate",
      },
      cwdMatchesThreadWorkspaces: false,
    });
    expect(msg).toContain("scratch-repo");
    expect(msg).toContain("Phase 1.5 substrate");
  });
});
