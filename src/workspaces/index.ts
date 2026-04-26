// src/workspaces/index.ts
export * from "./types.js";
export {
  identifyWorkspace,
  recordWorkspace,
  listWorkspaces,
  archiveWorkspace,
  unarchiveWorkspace,
  setNotes,
  forgetWorkspace,
  type ListOptions,
  type WorkspaceId,
} from "./tracker.js";
export { storePath, loadStore, saveStore } from "./store.js";
export {
  surfaceCurrentThread,
  formatThreadSurfaceMessage,
  type ThreadSurfaceInput,
} from "./thread-bridge.js";
