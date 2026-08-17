import { tokensLite } from "./runMetrics";

export type TokenUsageLike = { input?: number; output?: number; total?: number };

/** ~4 UTF-16 code units per token for unsaved draft + attached context. */
export function estimatePromptTokens(input: { draft: string; contextBytes: number }): number {
  return Math.ceil((Math.max(0, input.draft.length) + Math.max(0, input.contextBytes)) / 4);
}

/** Prefer billed total; otherwise billed input. Zero means no bill yet. */
export function billedTokens(usage?: TokenUsageLike): number {
  if (!usage) return 0;
  if (usage.total && usage.total > 0) return usage.total;
  return Math.max(0, usage.input ?? 0);
}

export function contextUsedTokens(input: {
  draft: string;
  contextBytes: number;
  billed?: TokenUsageLike;
}): { used: number; billed: number; draft: number } {
  const draft = estimatePromptTokens({ draft: input.draft, contextBytes: input.contextBytes });
  const billed = billedTokens(input.billed);
  return { used: billed + draft, billed, draft };
}

export function windowForModel(model?: string): number {
  const id = (model || "").toLowerCase();
  if (
    id.includes("claude") ||
    id.includes("opus") ||
    id.includes("sonnet") ||
    id.includes("haiku")
  ) {
    return 200_000;
  }
  return 128_000;
}

export function contextUsageChip(
  used: number,
  limit: number,
  parts?: { billed: number; draft: number },
): { pct: number; label: string; title: string } {
  const safeLimit = Math.max(limit, 1);
  const pct = Math.min(100, Math.round((Math.max(0, used) / safeLimit) * 100));
  const billed = parts?.billed ?? 0;
  const draft = parts?.draft ?? used;
  if (billed > 0) {
    return {
      pct,
      label: `${pct}% · ${tokensLite(used)}`,
      title: `账单 ${tokensLite(billed)} + 草稿 ${tokensLite(draft)} / ${tokensLite(limit)} tokens`,
    };
  }
  return {
    pct,
    label: `约 ${pct}% · ${tokensLite(used)}`,
    title: `估算上下文 ${tokensLite(used)} / ${tokensLite(limit)} tokens（按草稿与附件）`,
  };
}
