/** Timing-footer helpers (assistant-ui timing-footer element): wall-clock
 * duration of a finished run plus compact token counts. */

export function runDuration(run: {
  startedAt?: string;
  createdAt?: string;
  finishedAt?: string;
}): string {
  const start = run.startedAt || run.createdAt;
  if (!start || !run.finishedAt) return "";
  const from = new Date(start).getTime();
  const to = new Date(run.finishedAt).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return "";
  const seconds = Math.max(0, (to - from) / 1000);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

export function tokensLite(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
}

export function runTimingLabel(run: {
  startedAt?: string;
  createdAt?: string;
  finishedAt?: string;
  tokenUsage?: { input?: number; output?: number; total?: number };
}): string {
  const parts: string[] = [];
  const duration = runDuration(run);
  if (duration) parts.push(duration);
  const usage = run.tokenUsage;
  if (usage?.total) {
    const detail = [
      usage.input != null ? `${tokensLite(usage.input)} in` : "",
      usage.output != null ? `${tokensLite(usage.output)} out` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    parts.push(detail ? `${detail} — ${tokensLite(usage.total)} tokens` : `${tokensLite(usage.total)} tokens`);
  }
  return parts.join(" · ");
}
