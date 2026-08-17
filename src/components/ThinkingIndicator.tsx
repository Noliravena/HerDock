import { useEffect, useState } from "react";

export function elapsedClock(startedAt: string | undefined): string {
  const now = Date.now();
  const start = startedAt ? new Date(startedAt).getTime() : now;
  if (Number.isNaN(start)) return "";
  const seconds = Math.max(0, (now - start) / 1000);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

/**
 * Live status line in the assistant-ui thinking-indicator shape: pulsing dot,
 * shimmering activity label, tabular elapsed timer. The label is keyed so a
 * swap ("思考中" → "等待审批") replays the entrance animation.
 */
export function ThinkingIndicator({
  label,
  startedAt,
  className = "",
}: {
  label: string;
  startedAt?: string;
  className?: string;
}) {
  const [clock, setClock] = useState(() => elapsedClock(startedAt));
  useEffect(() => {
    setClock(elapsedClock(startedAt));
    const timer = window.setInterval(() => setClock(elapsedClock(startedAt)), 200);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return (
    <div className={`think ${className}`.trim()} aria-live="polite">
      <i className="think-dot" />
      <span key={label} className="think-label">
        {label}
      </span>
      {clock && <span className="think-time">{clock}</span>}
    </div>
  );
}
