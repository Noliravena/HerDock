import type { ProviderId, AutoExecuteLevel } from "./provider";
import type { SessionKind } from "./run";

/**
 * Workspace-level config file: `xingzhi.yml` at workspace root.
 * Can only tighten org policy, never relax it.
 */
export interface XingzhiWorkspaceConfig {
  /** Schema version for migrations. */
  version: 1;
  name?: string;
  defaultProvider?: ProviderId;
  defaultModel?: string;
  defaultKind?: SessionKind;
  /** Preferred auto-execute, clamped by org maxAutoExecute. */
  autoExecute?: AutoExecuteLevel;
  /** Paths (relative) always treated as high-signal context. */
  rules?: string[];
  /** Skill manifest paths or package ids. */
  skills?: string[];
  /** Extra write allow globs (still must pass org policy). */
  writeAllow?: string[];
  /** Analysis-oriented defaults. */
  analysis?: {
    dataGlobs?: string[];
    outputDir?: string;
  };
  /** Coding-oriented defaults. */
  coding?: {
    testCommand?: string;
    lintCommand?: string;
  };
}

export const DEFAULT_XINGZHI_CONFIG: XingzhiWorkspaceConfig = {
  version: 1,
  defaultProvider: "codex",
  defaultKind: "mixed",
  autoExecute: "ask_risky",
  rules: ["rules/**/*.md", "AGENTS.md"],
  skills: [],
  analysis: {
    dataGlobs: ["data/**/*"],
    outputDir: "out",
  },
  coding: {
    testCommand: "pnpm test",
  },
};
