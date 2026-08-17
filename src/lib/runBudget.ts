export const MAX_LIVE_RUNS = 2;

export const BUSY_RUN_STATUSES = new Set([
  "queued",
  "starting",
  "running",
  "waiting_approval",
]);

export function runIsBusy(
  run: { status: string } | null | undefined,
  launching = false,
): boolean {
  return launching || (!!run && BUSY_RUN_STATUSES.has(run.status));
}

export function liveRunCount(
  runs: { id: string; status: string }[],
  launchingSlots = 0,
): number {
  const busy = new Set(runs.filter((run) => BUSY_RUN_STATUSES.has(run.status)).map((run) => run.id));
  return busy.size + Math.max(0, launchingSlots);
}
