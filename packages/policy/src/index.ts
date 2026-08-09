export {
  clampAutoExecute,
  mergePolicy,
  evaluateWrite,
  evaluateRead,
  evaluateNetwork,
  classifyShellCommand,
  evaluateShell,
  alwaysAllowPermitted,
  type PathAccess,
  type ShellDecision,
} from "./evaluate";

export { matchGlob, matchesAnyRule, normalizeRelPath } from "./match";
