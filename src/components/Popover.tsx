import { useEffect, useRef, useState, type ReactNode } from "react";

type PopoverChildren = ReactNode | ((close: () => void) => ReactNode);

/**
 * Anchored popover used across the composer and toolbars in place of native
 * `<select>` / `<details>`, so every menu shares one look and one dismissal
 * contract (outside pointer-down, Escape, or an explicit close from content).
 */
export function Popover({
  label,
  title,
  children,
  align = "start",
  side = "top",
  className = "",
  disabled = false,
}: {
  label: ReactNode;
  title?: string;
  children: PopoverChildren;
  align?: "start" | "end";
  side?: "top" | "bottom";
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={`popover ${className} ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="popover-trigger"
        title={title}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div className={`popover-panel ${align} ${side}`} role="dialog">
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
