import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowClockwise,
  ArrowUpRight,
  CaretDown,
  Check,
  File as FileGlyph,
  FileText,
  FolderSimple,
  Pause,
  WarningCircle,
} from "@phosphor-icons/react";
import { elapsedClock } from "./ThinkingIndicator";

/** assistant-ui empty-state: greeting + optional chips or a primary action. */
export function PageEmpty({
  title,
  body,
  suggestions,
  onSuggest,
  action,
  className = "",
}: {
  title: string;
  body: string;
  suggestions?: string[];
  onSuggest?: (text: string) => void;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={`aui-empty ${className}`.trim()} data-slot="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
      {!!suggestions?.length && onSuggest && (
        <div className="aui-empty-actions">
          {suggestions.map((text, index) => (
            <button
              key={text}
              type="button"
              style={{ "--i": index } as CSSProperties}
              onClick={() => onSuggest(text)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      {action && (
        <div className="aui-empty-actions">
          <button type="button" className="primary" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}

/** assistant-ui error-state: quiet red banner with a retry path. */
export function ErrorBanner({
  title,
  detail,
  retrying,
  onRetry,
  className = "",
}: {
  title: string;
  detail: string;
  retrying?: boolean;
  onRetry?: () => void;
  className?: string;
}) {
  if (retrying) {
    return (
      <div className={`aui-error retrying ${className}`.trim()} role="status">
        <ArrowClockwise size={13} className="spin" />
        <span className="think-label">正在重试</span>
      </div>
    );
  }
  return (
    <div className={`aui-error ${className}`.trim()} role="alert">
      <WarningCircle size={16} weight="fill" />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          <ArrowClockwise size={12} />
          重试
        </button>
      )}
    </div>
  );
}

/** assistant-ui agent-status pill. */
export function StatusPill({
  state,
  label,
  elapsed,
  onPause,
  className = "",
}: {
  state: "working" | "waiting" | "done" | "failed";
  label: string;
  elapsed?: string;
  onPause?: () => void;
  className?: string;
}) {
  return (
    <div className={`aui-status-pill ${state} ${className}`.trim()} data-slot="agent-status">
      {state === "done" ? (
        <Check size={11} weight="bold" className="ok" />
      ) : (
        <i
          className={`run-dot ${
            state === "working" ? "running" : state === "failed" ? "failed" : "waiting_approval"
          }`}
        />
      )}
      <span key={label}>{label}</span>
      {elapsed && state !== "done" && <em className="mono">{elapsed}</em>}
      {onPause && state !== "done" && state !== "failed" && (
        <button type="button" aria-label="暂停" title="停止" onClick={onPause}>
          <Pause size={10} weight="fill" />
        </button>
      )}
    </div>
  );
}

/** assistant-ui long-job-progress: a real 2/5 fraction becomes a bar; otherwise only the label. */
export function JobBar({ progress, className = "" }: { progress: string; className?: string }) {
  const match = progress.match(/(\d+)\s*\/\s*(\d+)/);
  const total = match ? Number(match[2]) : 0;
  const ratio = match && total > 0 ? Math.min(1, Number(match[1]) / total) : null;
  return (
    <div className={`aui-job ${className}`.trim()} data-slot="job-progress">
      {ratio != null && (
        <span className="aui-job-track">
          <i style={{ width: `${ratio * 100}%` }} />
        </span>
      )}
      <em className="mono">{progress}</em>
    </div>
  );
}

/** assistant-ui approval-card / permission-grant. */
export function ApprovalCard({
  icon,
  title,
  subtitle,
  command,
  selected,
  onSelect,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  command: string;
  selected?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}) {
  return (
    <article className={`aui-approval${selected ? " on" : ""}`} data-slot="approval-card">
      <button type="button" className="aui-approval-head" onClick={onSelect}>
        <span className="aui-approval-icon">{icon}</span>
        <span>
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </span>
      </button>
      <pre className="aui-approval-cmd">{command}</pre>
      <footer className="aui-approval-actions">{children}</footer>
    </article>
  );
}

export function useElapsedLabel(startedAt?: string): string {
  const [clock, setClock] = useState(() => elapsedClock(startedAt));
  useEffect(() => {
    setClock(elapsedClock(startedAt));
    const timer = window.setInterval(() => setClock(elapsedClock(startedAt)), 200);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return clock;
}

/** assistant-ui artifact-card. */
export function ArtifactCard({
  title,
  meta,
  generating,
  onClick,
  trailing,
  className = "",
}: {
  title: string;
  meta: string;
  generating?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      <span className={`aui-artifact-icon${generating ? " pulse" : ""}`}>
        <FileText size={16} />
      </span>
      <span className="aui-artifact-copy">
        <strong>{title}</strong>
        <small className="mono">{generating ? "正在写入…" : meta}</small>
      </span>
      {trailing}
      {onClick && <ArrowUpRight size={13} className="hover-arrow" />}
    </>
  );
  if (!onClick) {
    return (
      <div className={`aui-artifact ${className}`.trim()} data-slot="artifact-card">
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`aui-artifact ${className}`.trim()}
      onClick={onClick}
      data-slot="artifact-card"
    >
      {inner}
    </button>
  );
}

/** assistant-ui spec-sheet. */
export function SpecSheet({
  title,
  subtitle,
  rows,
  className = "",
}: {
  title: string;
  subtitle?: string;
  rows: { label: string; value: string; emphasis?: boolean }[];
  className?: string;
}) {
  return (
    <div className={`aui-spec ${className}`.trim()} data-slot="spec-sheet">
      {(title || subtitle) && (
        <header>
          {title && <strong>{title}</strong>}
          {subtitle && <small>{subtitle}</small>}
        </header>
      )}
      <div className="inspect-rows">
        {rows.map((row) => (
          <div className="inspector-row" key={row.label}>
            <span className="mono">{row.label}</span>
            <strong className={`mono${row.emphasis ? " emphasis" : ""}`} title={row.value}>
              <span key={row.value} className="design-ticker">
                {row.value}
              </span>
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

/** assistant-ui connection-state banner. */
export function ConnectionBanner({ message }: { message: string }) {
  return (
    <div className="conn-banner aui-conn" role="status">
      <span className="conn-dot" aria-hidden="true" />
      {message}
    </div>
  );
}

/** assistant-ui cost-meter: in vs out share, no dollar conversion. */
export function CostMeter({
  input,
  output,
  className = "",
}: {
  input: number;
  output: number;
  className?: string;
}) {
  const total = Math.max(input + output, 1);
  return (
    <div className={`aui-cost ${className}`.trim()} data-slot="cost-meter">
      <span className="mono">tokens</span>
      <span className="aui-meter">
        <i style={{ width: `${Math.min(100, (input / total) * 100)}%` }} />
      </span>
      <em className="mono">
        {lite(input)} in · {lite(output)} out
      </em>
    </div>
  );
}

/** assistant-ui tool-call rows. */
export function ToolRows({
  items,
}: {
  items: { id: string; name: string; hint?: string; tone?: "ok" | "warn" | "bad" | "live" }[];
}) {
  if (!items.length) return null;
  return (
    <ul className="aui-tool-rows" data-slot="tool-timeline">
      {items.map((item) => (
        <li key={item.id} className={item.tone || ""}>
          <i className={`run-dot ${dotOf(item.tone)}`} />
          <span>
            <strong>{item.name}</strong>
            {item.hint && <small className="mono">{item.hint}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ConsoleShell({
  title,
  hostOnline,
  actions,
  children,
  bodyClassName = "",
  className = "",
}: {
  title: string;
  hostOnline: boolean;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <div className={`g-page ${className}`.trim()}>
      {!hostOnline && (
        <ConnectionBanner message="与本地核心的连接已断开，发送与文件操作暂不可用。" />
      )}
      <header className="g-page-head" data-tauri-drag-region>
        <h1>{title}</h1>
        {actions}
      </header>
      <div className={`g-page-body ${bodyClassName}`.trim()}>{children}</div>
    </div>
  );
}

/** assistant-ui confirm-dialog (generative notify-confirm anatomy). */
export type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  anchor?: "fixed" | "absolute";
};

/** In-app confirm that resolves like `window.confirm`, without a native dialog. */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [request, setRequest] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setRequest((previous) => {
          previous?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );
  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  const layer = request ? (
    <ConfirmCard
      title={request.title}
      body={request.body}
      confirmLabel={request.confirmLabel}
      danger={request.danger}
      anchor={request.anchor}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;
  return [confirm, layer];
}

export function ConfirmCard({
  title,
  body,
  confirmLabel,
  danger,
  anchor = "fixed",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  anchor?: "fixed" | "absolute";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);
  return (
    <div
      className={`aui-confirm-scrim ${anchor}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onCancel}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="aui-confirm" onMouseDown={(event) => event.stopPropagation()}>
        <strong>{title}</strong>
        <p>{body}</p>
        <footer>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={danger ? "primary danger" : "primary"}
            autoFocus
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** assistant-ui settings-panel switch. */
export function Switch({
  label,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`aui-switch${on ? " on" : ""}`}
      onClick={() => onToggle(!on)}
    >
      <i />
    </button>
  );
}

/** assistant-ui settings-panel switch: a label, the line explaining it, a real switch. */
export function ToggleRow({
  label,
  detail,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  detail: string;
  on: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="aui-toggle-row" data-slot="settings-toggle">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <Switch label={label} on={on} disabled={disabled} onToggle={onToggle} />
    </div>
  );
}

/** assistant-ui settings-panel segmented control: a mono micro-label over a pill track. */
export function SegmentedField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="aui-field" data-slot="settings-field">
      <span className="mono">{label}</span>
      <div className="aui-seg" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className={option.value === value ? "on" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** assistant-ui model-picker: the full list, grouped by family, with capability chips. */
export function ModelPickerList({
  items,
  selectedId,
  onSelect,
  className = "",
}: {
  items: {
    id: string;
    name: string;
    family: string;
    capabilities: string[];
    meta?: string;
    muted?: boolean;
  }[];
  selectedId: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const families = [...new Set(items.map((item) => item.family))];
  return (
    <div className={`aui-picker ${className}`.trim()} data-slot="model-picker">
      {families.map((family) => (
        <div className="aui-picker-family" key={family}>
          <span className="mono">{family}</span>
          {items
            .filter((item) => item.family === family)
            .map((item) => {
              const selected = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  className={`aui-picker-row${selected ? " on" : ""}${item.muted ? " muted" : ""}`}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="aui-picker-check">
                    {selected && <Check size={12} weight="bold" />}
                  </span>
                  <span className="aui-picker-copy">
                    <strong>{item.name}</strong>
                    {!!item.capabilities.length && (
                      <span className="aui-chips">
                        {item.capabilities.map((capability) => (
                          <em className="aui-chip mono" key={capability}>
                            {capability}
                          </em>
                        ))}
                      </span>
                    )}
                  </span>
                  {item.meta && <em className="mono aui-picker-meta">{item.meta}</em>}
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

export type TreeNode = {
  path: string;
  name: string;
  depth: number;
  kind: "folder" | "file";
  additions?: number;
  deletions?: number;
};

/** Fold a flat list of touched paths into the file-tree element's display order. */
export function buildFileTree(
  files: { path: string; additions?: number; deletions?: number }[],
): TreeNode[] {
  const nodes: TreeNode[] = [];
  let openDirs: string[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const segments = file.path.split(/[\\/]/).filter(Boolean);
    const dirs = segments.slice(0, -1);
    // Emit only the folders this file does not already share with the last one.
    let shared = 0;
    while (shared < dirs.length && shared < openDirs.length && dirs[shared] === openDirs[shared]) {
      shared += 1;
    }
    for (let depth = shared; depth < dirs.length; depth += 1) {
      nodes.push({
        path: dirs.slice(0, depth + 1).join("/"),
        name: dirs[depth],
        depth,
        kind: "folder",
      });
    }
    openDirs = dirs;
    nodes.push({
      path: file.path,
      name: segments[segments.length - 1] || file.path,
      depth: dirs.length,
      kind: "file",
      additions: file.additions,
      deletions: file.deletions,
    });
  }
  return nodes;
}

/** assistant-ui file-tree: everything a run touched, with the churn spelled out per file. */
export function FileTreeCard({
  nodes,
  totalAdditions,
  totalDeletions,
  activePath,
  onOpen,
  className = "",
}: {
  nodes: TreeNode[];
  totalAdditions: number;
  totalDeletions: number;
  activePath?: string;
  onOpen?: (path: string) => void;
  className?: string;
}) {
  const files = nodes.filter((node) => node.kind === "file").length;
  return (
    <div className={`aui-tree ${className}`.trim()} data-slot="file-tree">
      <header>
        <strong>{files} 个文件改动</strong>
        <span className="mono">
          <b className="add">+{totalAdditions}</b> <b className="del">−{totalDeletions}</b>
        </span>
      </header>
      <div className="aui-tree-rows">
        {nodes.map((node, index) => {
          const style = {
            paddingInlineStart: `${4 + node.depth * 13}px`,
            "--i": index,
          } as CSSProperties;
          if (node.kind === "folder") {
            return (
              <div className="aui-tree-row folder" key={`d:${node.path}`} style={style}>
                <CaretDown size={10} weight="bold" />
                <FolderSimple size={13} />
                <span>{node.name}</span>
              </div>
            );
          }
          return (
            <button
              type="button"
              key={`f:${node.path}`}
              style={style}
              className={`aui-tree-row file${activePath === node.path ? " on" : ""}`}
              title={node.path}
              onClick={() => onOpen?.(node.path)}
            >
              <FileGlyph size={13} />
              <span>{node.name}</span>
              <em className="mono">
                {node.additions ? <b className="add">+{node.additions}</b> : null}
                {node.deletions ? <b className="del">−{node.deletions}</b> : null}
              </em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function lite(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
}

function dotOf(tone?: "ok" | "warn" | "bad" | "live"): string {
  if (tone === "ok") return "completed";
  if (tone === "warn") return "waiting_approval";
  if (tone === "bad") return "failed";
  if (tone === "live") return "running";
  return "idle";
}
