export { scanStack, type StackProfile } from "./stack-detector.js";
export { buildContext, type BuildOptions } from "./context-builder.js";
export {
  renderToString,
  writeClaudeMd,
  checkStaleness,
  parseMarker,
  type ProjectContext,
  type WriteResult,
  type StalenessResult,
} from "./claude-md-writer.js";
export { runDev, type DevFlags, type DevResult } from "./dev-command.js";
