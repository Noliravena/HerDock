import { useEffect, useState } from "react";
import { elapsedClock } from "./ThinkingIndicator";

/** Animation clock that advances the pixel pattern and the elapsed counter. */
function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

/**
 * assistant-ui loading-state element: a pixel matrix that keeps time while
 * the model has nothing to show yet. Exactly three of nine cells stay lit —
 * cell i lights when (i·2 + ⌊tick/3⌋) mod 9 < 3 — so the highlight walks
 * through the grid while the shimmer label carries the status.
 */
export function GenerationLoader({
  label,
  startedAt,
  className = "",
}: {
  label: string;
  startedAt?: string;
  className?: string;
}) {
  const tick = useTick(140);
  const offset = Math.floor(tick / 3);
  const clock = useElapsed(startedAt);
  return (
    <div className={`gen-loader ${className}`.trim()} role="status" aria-label={label}>
      <div className="gen-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} className={`gen-cell${(index * 2 + offset) % 9 < 3 ? " on" : ""}`} />
        ))}
      </div>
      <span key={label} className="gen-label think-label">
        {label}
      </span>
      {clock && <span className="gen-time">{clock}</span>}
    </div>
  );
}

function useElapsed(startedAt: string | undefined): string {
  const [clock, setClock] = useState(() => elapsedClock(startedAt));
  useEffect(() => {
    setClock(elapsedClock(startedAt));
    const timer = window.setInterval(() => setClock(elapsedClock(startedAt)), 200);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return clock;
}

/** assistant-ui typing-indicator element: three dots pulsing in sequence.
 * `bubble` wraps them in a pill; `bare` is the dots alone. */
export function TypingDots({
  className = "",
  variant = "bare",
}: {
  className?: string;
  variant?: "bubble" | "bare";
}) {
  useTick(400);
  const dots = (
    <span className={`typing-dots ${className}`.trim()} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
  if (variant === "bubble") {
    return (
      <div className="typing-bubble" role="status" aria-label="正在输入">
        {dots}
      </div>
    );
  }
  return dots;
}
