import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrgId, PolicyBundle } from "@her-dock/agent-protocol";
import {
  clampAutoExecute,
  evaluateShell,
  evaluateWrite,
  mergePolicy,
} from "./evaluate.ts";

const base: PolicyBundle = {
  version: "1",
  orgId: "org_demo" as OrgId,
  maxAutoExecute: "auto_workspace",
  forceApprovalClasses: ["destructive", "network"],
  readAllow: [{ pattern: "**/*" }],
  writeAllow: [{ pattern: "src/**" }, { pattern: "out/**" }],
  writeDeny: [{ pattern: "src/secrets/**" }],
  networkAllow: [{ hostPattern: "api.github.com" }],
  networkDefaultDeny: true,
  enabledConnectors: [],
};

describe("evaluateWrite", () => {
  it("denies when writeDeny matches even if writeAllow matches", () => {
    assert.equal(evaluateWrite(base, "src/secrets/token.txt"), "deny");
  });

  it("allows paths under writeAllow", () => {
    assert.equal(evaluateWrite(base, "src/index.ts"), "allow");
    assert.equal(evaluateWrite(base, "out/report.xlsx"), "allow");
  });

  it("denies paths outside allow", () => {
    assert.equal(evaluateWrite(base, "README.md"), "deny");
  });
});

describe("clampAutoExecute", () => {
  it("never exceeds org max", () => {
    assert.equal(clampAutoExecute("auto_all", "ask_risky"), "ask_risky");
    assert.equal(clampAutoExecute("ask_always", "auto_workspace"), "ask_always");
  });
});

describe("mergePolicy", () => {
  it("tightens autoExecute from workspace config", () => {
    const merged = mergePolicy(base, {
      version: 1,
      autoExecute: "ask_always",
    });
    assert.equal(merged.maxAutoExecute, "ask_always");
  });
});

describe("evaluateShell", () => {
  it("requires approval for network under ask_risky", () => {
    const d = evaluateShell(base, "curl https://example.com", "ask_risky");
    assert.equal(d.class, "network");
    assert.equal(d.requiresApproval, true);
  });

  it("allows read-only under ask_risky without approval", () => {
    const d = evaluateShell(base, "git status", "ask_risky");
    assert.equal(d.class, "read_only");
    assert.equal(d.requiresApproval, false);
  });
});
