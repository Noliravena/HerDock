import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, Check, CircleNotch, FileText, TerminalWindow, X } from "@phosphor-icons/react";
import type { Approval, Checkpoint } from "../host/client";
import {
  ArtifactCard,
  ConnectionBanner,
  ErrorBanner,
  PageEmpty,
  SpecSheet,
  StatusPill,
} from "./pageElements";

export { useElapsedLabel } from "./pageElements";

/** assistant-ui typing-indicator — Chat panel bouncing dots. */
export function DesignTypingBubble() {
  return (
    <div className="design-chat-typing" data-slot="chat-panel-typing" role="status" aria-label="正在输入">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}

/** assistant-ui error-state: quiet red banner with a retry path. */
export function DesignErrorBanner(props: {
  title: string;
  detail: string;
  retrying: boolean;
  onRetry?: () => void;
}) {
  return <ErrorBanner className="design-error" {...props} />;
}

/** assistant-ui job-progress: weighted stages + cancel while a run is live. */
export function DesignJobProgress({
  title,
  stages,
  stageIndex,
  stageProgress,
  eta,
  onCancel,
}: {
  title: string;
  stages: { name: string }[];
  stageIndex: number;
  stageProgress: number;
  eta: string;
  onCancel?: () => void;
}) {
  const total = Math.max(stages.length, 1);
  const stage = Math.max(0, Math.min(stageIndex, total));
  const inner = Math.max(0, Math.min(stageProgress, 1));
  const overall = Math.min(100, ((stage + inner) / total) * 100);
  const finished = stage >= stages.length;
  return (
    <div className="design-job" data-slot="job-progress">
      <header>
        {finished ? (
          <Check size={13} weight="bold" className="ok" />
        ) : (
          <CircleNotch size={13} className="spin" />
        )}
        <strong>{title}</strong>
        <span className="mono">{finished ? "done" : eta}</span>
        {!finished && onCancel && (
          <button type="button" aria-label="取消生成" title="取消生成" onClick={onCancel}>
            <X size={12} />
          </button>
        )}
      </header>
      <span className="design-job-track" aria-hidden="true">
        <i style={{ width: `${overall}%` }} />
      </span>
      <div className="design-job-stages">
        {stages.map((item, index) => (
          <span
            key={item.name}
            className={`mono ${index < stage ? "done" : index === stage ? "active" : ""}`}
          >
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** assistant-ui agent-plan / todo-list: ordered steps with a progress count. */
export function DesignAgentPlan({
  steps,
}: {
  steps: { id: string; title: string; state: string }[];
}) {
  const [open, setOpen] = useState(true);
  const done = steps.filter((step) => step.state === "done").length;
  return (
    <div className={`design-plan ${open ? "open" : ""}`} data-slot="agent-plan">
      <button type="button" className="design-plan-head" onClick={() => setOpen((value) => !value)}>
        <span>计划</span>
        <span className="mono">
          {done}/{steps.length}
        </span>
      </button>
      <span className="design-job-track thin" aria-hidden="true">
        <i style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
      </span>
      {open && (
        <ul>
          {steps.map((step) => (
            <li key={step.id} className={step.state}>
              <i>
                {step.state === "done" ? (
                  <Check size={9} weight="bold" />
                ) : step.state === "running" ? (
                  <CircleNotch size={9} className="spin" />
                ) : step.state === "failed" ? (
                  "!"
                ) : null}
              </i>
              {step.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** assistant-ui agent-status pill. */
export function DesignStatusPill(props: {
  state: "working" | "waiting" | "done";
  label: string;
  elapsed?: string;
  onPause?: () => void;
}) {
  return <StatusPill className="design-status-pill" {...props} />;
}

/** assistant-ui approval-card / permission-grant. */
export function DesignApprovalCard({
  approval,
  onAllowOnce,
  onAlwaysAllow,
  onDeny,
}: {
  approval: Approval;
  onAllowOnce: () => void;
  onAlwaysAllow: () => void;
  onDeny: () => void;
}) {
  return (
    <article className="design-approval-card" data-slot="approval-card">
      <header>
        <span className="design-approval-icon">
          <TerminalWindow size={15} />
        </span>
        <span>
          <strong>{approval.title}</strong>
          <small>
            {approval.kind} · {approval.risk || "medium"}
          </small>
        </span>
      </header>
      <p className="design-approval-cmd">{approval.detail}</p>
      <footer>
        <button type="button" onClick={onDeny}>
          拒绝
        </button>
        <button type="button" onClick={onAlwaysAllow}>
          永久允许
        </button>
        <button type="button" className="primary" onClick={onAllowOnce}>
          批准一次
        </button>
      </footer>
    </article>
  );
}

/** assistant-ui spec-sheet: label/value rows, emphasis on the answering field. */
export function DesignSpecSheet(props: {
  title: string;
  subtitle?: string;
  rows: { label: string; value: string; emphasis?: boolean }[];
}) {
  return <SpecSheet className="design-spec" {...props} />;
}

/** assistant-ui artifact-card — used on the projects route. */
export function DesignArtifactCard(props: {
  title: string;
  meta: string;
  generating?: boolean;
  onClick?: () => void;
}) {
  return <ArtifactCard className="design-artifact-card" {...props} />;
}

/** assistant-ui empty-state: greeting + staggered suggestion chips. */
export function DesignEmptyColumn(props: {
  title: string;
  body: string;
  suggestions?: string[];
  onSuggest?: (text: string) => void;
  action?: { label: string; onClick: () => void };
}) {
  return <PageEmpty className="design-empty-hero" {...props} />;
}

/** assistant-ui onboarding: three steps, skip always available, last action is Start. */
export type DesignOnboardingStep = { title: string; body: string; example: string };

export function DesignOnboarding({
  steps,
  index,
  onNext,
  onSkip,
}: {
  steps: readonly DesignOnboardingStep[];
  index: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const current = Math.max(0, Math.min(index, steps.length - 1));
  const step = steps[current];
  if (!step) return null;
  const last = current >= steps.length - 1;
  return (
    <div className="design-onboard" data-slot="onboarding">
      <div key={current} className="design-onboard-copy">
        <span className="mono">
          {current + 1} / {steps.length}
        </span>
        <strong>{step.title}</strong>
        <p>{step.body}</p>
        <span className="design-onboard-example">{step.example}</span>
      </div>
      <div className="design-onboard-foot">
        <span className="design-onboard-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <i key={i} className={i === current ? "on" : ""} />
          ))}
        </span>
        <button type="button" onClick={onSkip}>
          跳过
        </button>
        <button type="button" className="primary" onClick={onNext}>
          {last ? "开始" : "下一步"}
        </button>
      </div>
    </div>
  );
}

/** assistant-ui connection-state banner. */
export function DesignConnectionBanner() {
  return <ConnectionBanner message="与本地核心的连接已断开，设计生成与文件操作暂不可用。" />;
}

/** assistant-ui scroll-anchor for the design session rail. */
export function DesignSessionViewport({
  pinKey,
  messageCount,
  children,
}: {
  pinKey: number;
  messageCount: number;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const seenRef = useRef(messageCount);
  const [unseen, setUnseen] = useState(0);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    pinnedRef.current = pinned;
    if (pinned && seenRef.current !== messageCount) {
      seenRef.current = messageCount;
      setUnseen(0);
    }
  }, [messageCount]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messageCount < seenRef.current) {
      seenRef.current = messageCount;
      pinnedRef.current = true;
      setUnseen(0);
    }
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (messageCount > seenRef.current) setUnseen(messageCount - seenRef.current);
  }, [pinKey, messageCount]);
  return (
    <div className="design-session-viewport">
      <div className="design-session-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="design-chat-messages" data-slot="chat-panel-messages">
          {children}
        </div>
      </div>
      {unseen > 0 && (
        <button
          type="button"
          className="design-session-anchor"
          onClick={() => {
            const el = scrollRef.current;
            pinnedRef.current = true;
            seenRef.current = messageCount;
            setUnseen(0);
            el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
        >
          <ArrowDown size={12} />
          {unseen === 1 ? "1 条新消息" : `${unseen} 条新消息`}
        </button>
      )}
    </div>
  );
}

/** assistant-ui confirm-dialog (generative notify-confirm anatomy). */
export function DesignConfirm({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="design-confirm-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="design-confirm-title"
    >
      <div className="design-confirm">
        <strong id="design-confirm-title">{title}</strong>
        <p>{body}</p>
        <footer>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** assistant-ui tool-timeline / tool-call / tool-failure rows. */
export function DesignToolTimeline({
  items,
}: {
  items: { id: string; name: string; hint: string; state: "running" | "done" | "failed" }[];
}) {
  if (!items.length) return null;
  return (
    <ul className="design-tool-timeline" data-slot="tool-timeline">
      {items.map((item) => (
        <li key={item.id} className={item.state}>
          <i
            className={`run-dot ${item.state === "failed" ? "failed" : item.state === "running" ? "running" : "completed"}`}
          />
          <span>
            <strong>{item.name}</strong>
            {item.hint && <small className="mono">{item.hint}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** assistant-ui code-diff summary: file rows with +/- counts. */
export function DesignEditsList({
  items,
  onOpen,
}: {
  items: { id: string; path: string; kind: string; additions?: number; deletions?: number }[];
  onOpen: (path: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="design-edits" data-slot="code-diff">
      <span className="mono legend">EDITS</span>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onOpen(item.path)}>
          <em className={item.kind}>{item.kind}</em>
          <span className="mono">{item.path}</span>
          <small>
            <b>+{item.additions ?? 0}</b>
            <i>−{item.deletions ?? 0}</i>
          </small>
        </button>
      ))}
    </div>
  );
}

/** assistant-ui recommendation-card wrapping a variant pick. */
export function DesignRecommendation({
  question,
  body,
  accepted,
  onAccept,
  onAlternatives,
}: {
  question: string;
  body: ReactNode;
  accepted: boolean;
  onAccept: () => void;
  onAlternatives: () => void;
}) {
  return (
    <div className="design-recommend" data-slot="recommendation-card">
      <p className="question">{question}</p>
      <div className="body">{body}</div>
      {accepted ? (
        <p className="accepted">
          <Check size={12} weight="bold" />
          已选中这一版，后续迭代会基于它
        </p>
      ) : (
        <footer>
          <span className="mono confidence">当前画布</span>
          <button type="button" onClick={onAlternatives}>
            其他方案
          </button>
          <button type="button" className="primary" onClick={onAccept}>
            采用
          </button>
        </footer>
      )}
    </div>
  );
}

/** assistant-ui checkpoints card. */
export function DesignCheckpointCard({
  checkpoint,
  current,
  onPreview,
}: {
  checkpoint: Checkpoint;
  current: boolean;
  onPreview: () => void;
}) {
  return (
    <article className={`design-checkpoint ${current ? "current" : ""}`} data-slot="checkpoint">
      <div className="version-top">
        <span className="mono">{checkpoint.id.slice(0, 10)}</span>
        <span className="version-tag">{current ? "当前" : "检查点"}</span>
        <span className="mono version-time">{timeLabel(checkpoint.createdAt)}</span>
      </div>
      <p>{checkpoint.label}</p>
      <div className="version-foot">
        <span className="mono">{checkpoint.runId || "—"}</span>
        <button type="button" onClick={onPreview}>
          预览此版本
        </button>
      </div>
    </article>
  );
}

/** assistant-ui file-tree lite: project artifact paths. */
export function DesignPathTree({
  paths,
  active,
  onOpen,
}: {
  paths: string[];
  active?: string;
  onOpen: (path: string) => void;
}) {
  if (!paths.length) return null;
  return (
    <div className="design-path-tree" data-slot="file-tree">
      <span className="mono legend">FILES</span>
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          className={path === active ? "active" : ""}
          onClick={() => onOpen(path)}
        >
          <FileText size={12} />
          <span className="mono">{path}</span>
        </button>
      ))}
    </div>
  );
}

/** assistant-ui comparison-card for two or three variants. */
export function DesignComparison({
  options,
  recommendedId,
  reason,
  onPick,
}: {
  options: { id: string; name: string; headline: string; traits: (string | false)[] }[];
  recommendedId: string;
  reason: string;
  onPick: (id: string) => void;
}) {
  const labels = ["格式", "状态", "入口"];
  return (
    <div className="design-compare" data-slot="comparison-card">
      <div className="design-compare-row">
        {options.map((option) => {
          const recommended = option.id === recommendedId;
          return (
            <button
              key={option.id}
              type="button"
              className={recommended ? "pick" : ""}
              onClick={() => onPick(option.id)}
            >
              <span>
                <strong>{option.name}</strong>
                {recommended && <em className="mono">pick</em>}
              </span>
              <small>{option.headline}</small>
              <ul>
                {labels.map((label, index) => {
                  const trait = option.traits[index];
                  return (
                    <li key={label} className={trait ? "" : "absent"}>
                      {trait ? <Check size={10} weight="bold" /> : <span>—</span>}
                      {trait || label}
                    </li>
                  );
                })}
              </ul>
            </button>
          );
        })}
      </div>
      <p>{reason}</p>
    </div>
  );
}

export function DesignQueuedNote() {
  return (
    <div className="design-queued" role="status" data-slot="message-queue">
      <i className="run-dot waiting_approval" />
      已排队，上一个设计任务结束后开始。
    </div>
  );
}

function timeLabel(value?: string): string {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
