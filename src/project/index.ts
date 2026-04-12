// ── Public API for the project module ────────────────────────────────

export {
  classifyProject,
  getRecommendedTemplate,
  getRecommendedProfiles,
  type ProjectType,
  type ProjectClassification,
} from "./detector.js";

export {
  buildModuleMap,
  hasOverlap,
  assignModules,
  type DirectoryEntry,
  type ModuleEntry,
  type ModuleMap,
} from "./module-map.js";

export {
  createMetrics,
  recordTaskCompletion,
  recordPhaseStart,
  recordPhaseCompletion,
  recordApprovalGate,
  finalizeMetrics,
  formatMetrics,
  type PhaseMetrics,
  type AgentMetrics,
  type OrchestrationMetrics,
} from "./monitoring.js";
