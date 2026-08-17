import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type ContextMenuItem =
  | {
      id: string;
      type?: "item";
      label: string;
      danger?: boolean;
      disabled?: boolean;
      icon?: ReactNode;
      onSelect: () => void;
    }
  | { id: string; type: "separator" };

type Props = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

function isAction(item: ContextMenuItem): item is Extract<ContextMenuItem, { onSelect: () => void }> {
  return item.type !== "separator";
}

/** Pointer-positioned menu. Closes on outside click, Escape, or a chosen item. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => items.findIndex((item) => isAction(item) && !item.disabled));
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - rect.width - 8),
      top: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      const enabled = items
        .map((item, index) => ({ item, index }))
        .filter((entry) => isAction(entry.item) && !entry.item.disabled);
      if (!enabled.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const current = Math.max(
          0,
          enabled.findIndex((entry) => entry.index === active),
        );
        setActive(enabled[(current + step + enabled.length) % enabled.length].index);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const item = items[active];
        if (item && isAction(item) && !item.disabled) {
          item.onSelect();
          onClose();
        }
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [active, items, onClose]);

  return (
    <div
      ref={rootRef}
      className="context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
    >
      {items.map((item, index) =>
        item.type === "separator" ? (
          <div key={item.id} className="context-sep" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`${item.danger ? "danger" : ""} ${index === active ? "active" : ""}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            {item.icon && <span className="context-ico">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
