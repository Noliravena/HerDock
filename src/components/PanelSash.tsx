import { useRef } from "react";

type Props = {
  label: string;
  /** When true, dragging toward the origin grows the panel. */
  invert?: boolean;
  orientation?: "vertical" | "horizontal";
  value: number;
  onChange: (size: number) => void;
  onReset: () => void;
};

/** Thin hit target on a panel edge. Drag to resize, double-click to restore the default. */
export function PanelSash({
  label,
  invert = false,
  orientation = "vertical",
  value,
  onChange,
  onReset,
}: Props) {
  const drag = useRef<{ pos: number; size: number } | null>(null);
  const horizontal = orientation === "horizontal";

  return (
    <div
      className={`panel-sash ${horizontal ? "horizontal" : ""}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      title={`${label} · 双击恢复默认`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { pos: horizontal ? event.clientY : event.clientX, size: value };
        event.currentTarget.classList.add("active");
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* synthetic events have no active pointer */
        }
        document.body.classList.add(horizontal ? "is-resizing-y" : "is-resizing");
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        const delta = (horizontal ? event.clientY : event.clientX) - start.pos;
        onChange(invert ? start.size - delta : start.size + delta);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        drag.current = null;
        event.currentTarget.classList.remove("active");
        document.body.classList.remove("is-resizing", "is-resizing-y");
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        document.body.classList.remove("is-resizing", "is-resizing-y");
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        onReset();
      }}
    />
  );
}
