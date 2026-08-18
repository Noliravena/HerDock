import type {
  AgentEvent,
  CheckpointCreatedEvent,
  FileEditEvent,
  HumanDecisionEvent,
  PlanStep,
  PlanUpdatedEvent,
  ShellExitEvent,
  ShellOutputEvent,
  ShellStartEvent,
  TableResultEvent,
  ToolOutputEvent,
  ToolRequestedEvent,
} from "@her-dock/agent-protocol";
import {
  ArrowClockwise,
  CaretDown,
  Check,
  CircleNotch,
  Copy,
  FileText,
  GitFork,
  Globe,
  ListBullets,
  MagnifyingGlass,
  PencilSimple,
  StopCircle,
  TerminalWindow,
  WarningCircle,
  Wrench,
  type Icon,
} from "@phosphor-icons/react";
import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { chatModelLabel } from "../lib/models";
import { QUICK } from "../lib/prompts";
import { runDuration, tokensLite } from "../lib/runMetrics";
import { useWorkbench } from "../store/workbench";
import { GenerationLoader, TypingDots } from "./GenerationLoader";
import { Markdown } from "./Markdown";
import { CheckpointPreviewDialog } from "./pageElements";

const TERMINAL_PREVIEW_LINES = 400;
const PROSE_PREVIEW_CHARS = 40_000;
const TOOL_PREVIEW_CHARS = 20_000;
const TABLE_PREVIEW_ROWS = 200;
/** Streaming words beyond this window are rendered through markdown instead. */
const PLAIN_TAIL_MAX = 800;

type TerminalBlock = {
  kind: "terminal";
  id: string;
  command: string;
  lines: { text: string; tone: string }[];
  exit?: ShellExitEvent;
};

type Block =
  | { kind: "prose"; id: string; text: string }
  | { kind: "plan"; id: string; steps: PlanStep[] }
  | TerminalBlock
  | { kind: "edits"; id: string; items: FileEditEvent[] }
  | { kind: "checkpoints"; id: string; items: CheckpointCreatedEvent[] }
  | { kind: "table"; id: string; ev: TableResultEvent }
  | { kind: "decision"; id: string; ev: HumanDecisionEvent }
  | { kind: "error"; id: string; message: string; retriable: boolean }
  | { kind: "tool"; id: string; request: ToolRequestedEvent; output?: ToolOutputEvent };

type AgentTurn = { role: "agent"; id: string; blocks: Block[] };
type Turn = { role: "user"; id: string; text: string; ts?: string; seq?: number } | AgentTurn;

/** Fold the flat event stream into user bubbles and agent turns of design cards. */
function buildTurns(events: AgentEvent[]): Turn[] {
  const turns: Turn[] = [];
  let agent: AgentTurn | undefined;

  for (const e of events) {
    if (e.type === "message.user") {
      agent = undefined;
      turns.push({ role: "user", id: e.id, text: e.text, ts: e.ts, seq: e.seq });
      continue;
    }
    if (!agent) {
      agent = { role: "agent", id: `turn-${e.id}`, blocks: [] };
      turns.push(agent);
    }
    const blocks = agent.blocks;
    const last: Block | undefined = blocks[blocks.length - 1];

    switch (e.type) {
      case "assistant_delta":
      case "message.assistant":
        if (last?.kind === "prose") last.text += e.text;
        else blocks.push({ kind: "prose", id: e.id, text: e.text });
        break;
      case "plan_updated":
      case "plan.updated": {
        const plan = e as PlanUpdatedEvent;
        const prev = blocks.find((b): b is Extract<Block, { kind: "plan" }> => b.kind === "plan");
        if (prev) prev.steps = plan.steps;
        else blocks.push({ kind: "plan", id: e.id, steps: plan.steps });
        break;
      }
      case "shell.start":
        blocks.push({
          kind: "terminal",
          id: e.id,
          command: (e as ShellStartEvent).command,
          lines: [],
        });
        break;
      case "shell.output": {
        const out = e as ShellOutputEvent;
        let terminal = last?.kind === "terminal" ? last : undefined;
        if (!terminal) {
          terminal = {
            kind: "terminal",
            id: `terminal-${e.id}`,
            command: "已加载的终端输出片段",
            lines: [],
          };
          blocks.push(terminal);
        }
        for (const line of out.text.split("\n")) {
          if (line === "") continue;
          terminal.lines.push({ text: line, tone: out.stream === "stderr" ? "err" : "" });
        }
        break;
      }
      case "shell.exit":
        if (last && last.kind === "terminal") last.exit = e as ShellExitEvent;
        break;
      case "tool_requested":
      case "tool.requested":
        blocks.push({ kind: "tool", id: e.id, request: e as ToolRequestedEvent });
        break;
      case "tool_output":
      case "tool.output": {
        const output = e as ToolOutputEvent;
        const tool = [...blocks]
          .reverse()
          .find(
            (block): block is Extract<Block, { kind: "tool" }> =>
              block.kind === "tool" && block.request.toolCallId === output.toolCallId,
          );
        if (tool) tool.output = output;
        break;
      }
      case "file_patch":
      case "file.edit_proposed":
      case "file.edit_applied":
        if (last && last.kind === "edits") last.items.push(e as FileEditEvent);
        else blocks.push({ kind: "edits", id: e.id, items: [e as FileEditEvent] });
        break;
      case "checkpoint_created":
      case "checkpoint.created":
        if (last && last.kind === "checkpoints") last.items.push(e as CheckpointCreatedEvent);
        else blocks.push({ kind: "checkpoints", id: e.id, items: [e as CheckpointCreatedEvent] });
        break;
      case "table.result":
        blocks.push({ kind: "table", id: e.id, ev: e as TableResultEvent });
        break;
      case "human.decision": {
        const d = e as HumanDecisionEvent;
        if (d.options.length) blocks.push({ kind: "decision", id: e.id, ev: d });
        break;
      }
      case "failed":
      case "error": {
        const err = e as { message?: string; retriable?: boolean };
        blocks.push({
          kind: "error",
          id: e.id,
          message: String(err.message || "运行出错"),
          retriable: err.retriable !== false,
        });
        break;
      }
      default:
        break;
    }
  }
  return turns.filter((t) => t.role === "user" || t.blocks.length > 0);
}

/** Coarse message count consumed by the scroll anchor's unseen badge. */
export function countChatMessages(events: AgentEvent[]): number {
  return buildTurns(events).length;
}

export function latestPlanSteps(events: AgentEvent[]): PlanStep[] | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "plan_updated" && event.type !== "plan.updated") continue;
    return event.steps.length ? event.steps : null;
  }
  return null;
}

export function ChatApprovalBar() {
  const { approvals, resolveApproval, run } = useWorkbench(
    useShallow((state) => ({
      approvals: state.approvals,
      resolveApproval: state.resolveApproval,
      run: state.run,
    })),
  );
  const pending = approvals.filter((item) => item.runId === run?.id);
  if (!pending.length) return null;
  return (
    <section className="chat-approval-bar" aria-label="待审批">
      {pending.map((item) => (
        <div className="chat-approval-item" key={item.approvalId}>
          <div className="chat-approval-copy">
            <strong>{item.title || "待审批"}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </div>
          <div className="chat-approval-actions">
            <button type="button" onClick={() => void resolveApproval(item.approvalId, "deny")}>
              拒绝
            </button>
            <button
              type="button"
              onClick={() => void resolveApproval(item.approvalId, "allow_run")}
            >
              本次运行
            </button>
            <button
              type="button"
              onClick={() => void resolveApproval(item.approvalId, "always_allow")}
            >
              永久允许
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void resolveApproval(item.approvalId, "approve_once")}
            >
              批准一次
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

export function PlanStatusBar({ events }: { events: AgentEvent[] }) {
  const steps = useMemo(() => latestPlanSteps(events), [events]);
  const [open, setOpen] = useState(false);
  if (!steps?.length) return null;
  const live = steps.some((step) => step.state === "running");
  const done = steps.filter((step) => step.state === "done").length;
  const current =
    steps.find((step) => step.state === "running") ||
    steps.find((step) => step.state === "pending") ||
    steps[steps.length - 1];
  return (
    <section className={`plan-sticky bui-trace${open ? " open" : ""}${live ? " live" : ""}`}>
      <button type="button" className="bui-trace-head" onClick={() => setOpen((value) => !value)}>
        <CaretDown size={12} className="bui-caret" />
        <span className="bui-trace-label">
          {done}/{steps.length}
          {current ? ` · ${current.title}` : ""}
        </span>
        <span className="bui-trace-meta">{live ? "进行中" : "计划"}</span>
      </button>
      <div className="bui-trace-body">
        <div className="bui-trace-steps">
          {steps.map((step) => (
            <div className={`bui-step ${step.state}`} key={step.id}>
              <span className={`bui-step-mark ${step.state}`}>
                {step.state === "done" ? (
                  <Check size={9} weight="bold" />
                ) : step.state === "running" ? (
                  <CircleNotch size={9} weight="bold" className="spin" />
                ) : null}
              </span>
              <span className="bui-step-title">{step.title}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Thread({
  events,
  onOpenFile,
  findQuery = "",
  findIndex = 0,
}: {
  events: AgentEvent[];
  onOpenFile: (path: string) => void;
  findQuery?: string;
  findIndex?: number;
}) {
  const {
    checkpointPreview,
    continueRun,
    draft,
    forkSession,
    hasEarlierEvents,
    kind,
    loadingEarlierEvents,
    loadEarlierEvents,
    model,
    providerId,
    providerProfiles,
    restoreCheckpoint,
    run,
    runs,
    selectRun,
    setCenterView,
    setDraft,
  } = useWorkbench(
    useShallow((state) => ({
      checkpointPreview: state.checkpointPreview,
      continueRun: state.continueRun,
      draft: state.draft,
      forkSession: state.forkSession,
      hasEarlierEvents: state.hasEarlierEvents,
      kind: state.kind,
      loadingEarlierEvents: state.loadingEarlierEvents,
      loadEarlierEvents: state.loadEarlierEvents,
      model: state.model,
      providerId: state.providerId,
      providerProfiles: state.providerProfiles,
      restoreCheckpoint: state.restoreCheckpoint,
      run: state.run,
      runs: state.runs,
      selectRun: state.selectRun,
      setCenterView: state.setCenterView,
      setDraft: state.setDraft,
    })),
  );
  const turns = useMemo(() => buildTurns(events), [events]);
  const relatedRuns = runs.filter((item) => item.id !== run?.id).slice(0, 3);
  // The assistant's chat identity is the model; CLIs are connections in Settings.
  const assistantName = run?.model?.trim() || chatModelLabel(model, providerId, providerProfiles);
  const needle = findQuery.trim().toLowerCase();
  const lastUserId = [...turns].reverse().find((turn) => turn.role === "user")?.id;
  let hitCursor = -1;

  const latestRunId = runs[0]?.id || run?.id;
  const canForkFromTurn = !latestRunId || run?.id === latestRunId;
  const streaming = !!run && ["starting", "running"].includes(run.status);
  const lastTurn = turns[turns.length - 1];
  const streamingBlockId =
    streaming && lastTurn?.role === "agent"
      ? lastTurn.blocks[lastTurn.blocks.length - 1]?.id
      : undefined;
  const showThinking = streaming && (!lastTurn || lastTurn.role === "user");

  if (!turns.length && !run) {
    return (
      <div className="thread">
        <div className="empty-hint">发送一条消息，开始这次对话。</div>
      </div>
    );
  }

  let prevDayKey: string | undefined;

  return (
    <div className="thread">
      {hasEarlierEvents && (
        <div className="history-loader">
          <button
            type="button"
            className="ghost-btn"
            disabled={loadingEarlierEvents}
            onClick={() => void loadEarlierEvents()}
          >
            {loadingEarlierEvents ? <TypingDots /> : "加载更早内容"}
          </button>
          <span>当前显示 {events.length} 条事件</span>
        </div>
      )}
      {run?.prompt && !turns.some((turn) => turn.role === "user") && (
        <UserBubble
          id="run-prompt"
          text={run.prompt}
          canEdit
          activeHit={false}
          onEdit={(text) => setDraft(text)}
        />
      )}
      {turns.map((turn) =>
        turn.role === "user" ? (
          (() => {
            const isHit = !!needle && turn.text.toLowerCase().includes(needle);
            if (isHit) hitCursor += 1;
            const dayKey = turn.ts ? new Date(turn.ts).toDateString() : undefined;
            const showDay = !!dayKey && prevDayKey !== undefined && dayKey !== prevDayKey;
            if (dayKey) prevDayKey = dayKey;
            return (
              <Fragment key={turn.id}>
                {showDay && dayKey && <DaySeparator ts={turn.ts as string} />}
                <UserBubble
                  id={turn.id}
                  text={turn.text}
                  ts={turn.ts}
                  query={needle}
                  canEdit={turn.id === lastUserId}
                  activeHit={isHit && hitCursor === findIndex}
                  onEdit={(text) => setDraft(text)}
                  onFork={
                    canForkFromTurn && turn.seq != null
                      ? () => void forkSession(turn.seq)
                      : undefined
                  }
                />
              </Fragment>
            );
          })()
        ) : (
          <div className="turn" key={turn.id}>
            <div className="turn-speaker">
              <span className="speaker-dot" aria-hidden="true" />
              <span className="speaker-name">{assistantName || "Assistant"}</span>
            </div>
            <div className="turn-body">
              {turn.blocks.map((b) => (
                <BlockView
                  key={b.id}
                  block={b}
                  onOpenFile={onOpenFile}
                  streaming={b.id === streamingBlockId && b.kind === "prose"}
                />
              ))}
              <TurnActions
                turn={turn}
                canRetry={!streaming && turn === turns[turns.length - 1] && !!run}
              />
            </div>
          </div>
        ),
      )}

      {showThinking && (
        <GenerationLoader
          className="gen-thread"
          label="正在生成"
          startedAt={run?.startedAt || run?.createdAt}
        />
      )}

      {run?.status === "completed" && (runDuration(run) || run.tokenUsage?.total) && (
        <div className="turn-timing" aria-label="本次运行耗时与用量">
          {runDuration(run) && <span>{runDuration(run)}</span>}
          {run.tokenUsage?.total ? (
            <span>
              {run.tokenUsage.input != null && `${tokensLite(run.tokenUsage.input)} in · `}
              {run.tokenUsage.output != null && `${tokensLite(run.tokenUsage.output)} out · `}
              {tokensLite(run.tokenUsage.total)} tokens
            </span>
          ) : null}
        </div>
      )}

      {run?.status === "cancelled" && !streaming && (
        <div className="stopped-note" role="status">
          <StopCircle size={13} weight="fill" />
          <span>运行已停止，未完成的内容不会继续。</span>
          <button type="button" className="card-link" onClick={() => void continueRun()}>
            继续
          </button>
        </div>
      )}

      {run?.status === "completed" && !streaming && !draft.trim() && lastTurn?.role === "agent" && (
        <div className="thread-followups">
          {QUICK[kind].map((q, index) => {
            const QuickIcon = q.icon;
            return (
              <button
                key={q.label}
                type="button"
                className="chip"
                style={{ "--i": index } as CSSProperties}
                onClick={() => setDraft(q.text)}
              >
                <QuickIcon size={11} />
                {q.label}
              </button>
            );
          })}
        </div>
      )}

      {relatedRuns.length > 0 && (
        <section className="card related-runs">
          <header>
            <span className="card-tag">相关运行</span>
            <button
              type="button"
              className="card-link push"
              onClick={() => setCenterView("activity")}
            >
              查看全部
            </button>
          </header>
          {relatedRuns.map((r) => (
            <button
              key={r.id}
              type="button"
              className="related-row"
              onClick={() => void selectRun(r.id)}
            >
              <span className={`run-dot ${r.status}`} />
              <span className="id">{r.id}</span>
              <span className="name">{r.prompt.slice(0, 28) || "未命名运行"}</span>
              <span className="meta">
                {chatModelLabel(r.model, r.providerId, providerProfiles) || r.providerId} ·{" "}
                {r.planProgress || r.status}
              </span>
            </button>
          ))}
        </section>
      )}

      {checkpointPreview && (
        <CheckpointPreviewDialog
          preview={checkpointPreview}
          onClose={() => useWorkbench.setState({ checkpointPreview: null })}
          onRestore={(id) => restoreCheckpoint(id)}
        />
      )}
    </div>
  );
}

/** Wall-clock duration + compact tokens live in lib/runMetrics (timing-footer). */

/** Hover-revealed actions for a finished assistant turn: copy confirms in
 * place, retry restarts the run (assistant-ui message-actions pattern). */
function TurnActions({ turn, canRetry }: { turn: AgentTurn; canRetry: boolean }) {
  const retryRun = useWorkbench((state) => state.retryRun);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const text = turn.blocks
    .filter((b): b is Extract<Block, { kind: "prose" }> => b.kind === "prose")
    .map((b) => b.text)
    .join("\n\n");
  return (
    <div className="msg-actions">
      {text && (
        <button
          type="button"
          className={`msg-action-btn${copied ? " done" : ""}`}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              })
              .catch(() => undefined);
          }}
        >
          {copied ? <Check size={11} weight="bold" /> : <Copy size={11} />}
          {copied ? "已复制" : "复制"}
        </button>
      )}
      {canRetry &&
        (retrying ? (
          <span className="msg-action-btn done">
            <CircleNotch size={11} className="spin" />
            重试中
          </span>
        ) : (
          <button
            type="button"
            className="msg-action-btn"
            onClick={() => {
              setRetrying(true);
              void retryRun().catch(() => setRetrying(false));
            }}
          >
            <ArrowClockwise size={11} />
            重试
          </button>
        ))}
    </div>
  );
}

function DaySeparator({ ts }: { ts: string }) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const label = d.toLocaleDateString(
    "zh-CN",
    d.getFullYear() === now.getFullYear()
      ? { month: "long", day: "numeric" }
      : { year: "numeric", month: "long", day: "numeric" },
  );
  return (
    <div className="day-sep" role="separator">
      <span>{label}</span>
    </div>
  );
}

const BlockView = memo(function AgentBlockView({
  block,
  onOpenFile,
  streaming,
}: {
  block: Block;
  onOpenFile: (p: string) => void;
  streaming?: boolean;
}) {
  const { answerDecision, answeredDecisions, setDraft } = useWorkbench(
    useShallow((state) => ({
      answerDecision: state.answerDecision,
      answeredDecisions: state.answeredDecisions,
      setDraft: state.setDraft,
    })),
  );

  switch (block.kind) {
    case "prose":
      return <Prose text={block.text} streaming={streaming} />;

    case "plan":
      return <PlanTrace steps={block.steps} />;

    case "terminal":
      return <TerminalCard block={block} />;

    case "tool":
      return <ToolCard block={block} />;

    case "edits":
      return <EditsChip items={block.items} onOpenFile={onOpenFile} />;

    case "checkpoints":
      return <CheckpointsChip items={block.items} />;

    case "table":
      return <TableChip event={block.ev} />;

    case "decision": {
      const answered = answeredDecisions[block.id] || block.ev.selectedOptionId;
      return (
        <section className="bui-approval">
          <div className="bui-approval-pad">
            <div className="bui-approval-q">{block.ev.question}</div>
            {answered ? (
              <div className="bui-approval-done">已回复：{answered}</div>
            ) : (
              <div className="bui-approval-choices">
                {block.ev.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={o.primary ? "on" : ""}
                    onClick={() => void answerDecision(block.id, o.id, o.label)}
                  >
                    <span className="bui-radio" />
                    {o.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="bui-custom"
                  onClick={() => setDraft(`关于「${block.ev.question}」：`)}
                >
                  我自己写一条
                </button>
              </div>
            )}
          </div>
        </section>
      );
    }

    case "error":
      return <ErrorBanner message={block.message} retriable={block.retriable} />;
  }
});

/** Inline failure banner with a retry path, in the assistant-ui error-state shape. */
function ErrorBanner({ message, retriable }: { message: string; retriable: boolean }) {
  const retryRun = useWorkbench((state) => state.retryRun);
  const [retrying, setRetrying] = useState(false);
  return (
    <div className={`bui-error${retrying ? " retrying" : ""}`} role={retrying ? "status" : "alert"}>
      <WarningCircle size={15} weight="fill" className="bui-error-icon" />
      <div className="bui-error-text">
        <b>运行出错</b>
        <span>{message}</span>
      </div>
      {retriable &&
        (retrying ? (
          <span className="bui-error-retrying">
            <ArrowClockwise size={12} className="spin" />
            正在重试
          </span>
        ) : (
          <button
            type="button"
            className="bui-error-retry"
            onClick={() => {
              setRetrying(true);
              void retryRun().catch(() => setRetrying(false));
            }}
          >
            <ArrowClockwise size={12} />
            重试
          </button>
        ))}
    </div>
  );
}

function planSeconds(steps: PlanStep[]): number {
  return steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0) / 1000;
}

function PlanTrace({ steps }: { steps: PlanStep[] }) {
  const live = steps.some((step) => step.state === "running");
  const [open, setOpen] = useState(live);
  const touched = useRef(false);
  // Follow the run while untouched: expand on first activity, settle to a
  // collapsed summary once the thinking finishes.
  useEffect(() => {
    if (touched.current) return;
    setOpen(live || steps.some((s) => s.state === "pending"));
  }, [live, steps]);
  const done = steps.filter((step) => step.state === "done").length;
  const seconds = planSeconds(steps);
  return (
    <section className={`bui-trace${open ? " open" : ""}${live ? " live" : ""}`}>
      <button
        type="button"
        className="bui-trace-head"
        onClick={() => {
          touched.current = true;
          setOpen((value) => !value);
        }}
      >
        <CaretDown size={12} className="bui-caret" />
        <span className="bui-trace-label">{live ? "思考中" : "思考"}</span>
        <span className="bui-trace-meta">
          {done}/{steps.length}
          {seconds > 0 ? ` · ${seconds.toFixed(1)}s` : ""}
        </span>
      </button>
      <div className="bui-trace-body">
        <div className="bui-trace-steps">
          {steps.map((step) => (
            <div className={`bui-step ${step.state}`} key={step.id}>
              <span className={`bui-step-mark ${step.state}`}>
                {step.state === "done" ? (
                  <Check size={9} weight="bold" />
                ) : step.state === "running" ? (
                  <CircleNotch size={9} weight="bold" className="spin" />
                ) : null}
              </span>
              <span className="bui-step-title">{step.title}</span>
              <span className="bui-step-dur">
                {step.durationMs != null
                  ? `${(step.durationMs / 1000).toFixed(1)}s`
                  : step.state === "pending"
                    ? "待执行"
                    : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const TOOL_ICONS: [RegExp, Icon][] = [
  [/bash|shell|terminal|exec|command|run_script/, TerminalWindow],
  [/write|edit|apply|patch|save/, PencilSimple],
  [/read|view|open|cat|load/, FileText],
  [/grep|search|find|query/, MagnifyingGlass],
  [/glob|list|ls|tree|dir/, ListBullets],
  [/fetch|web|http|url|browser|navigate/, Globe],
];

function toolIcon(name: string): Icon {
  const lower = name.toLowerCase();
  for (const [pattern, icon] of TOOL_ICONS) if (pattern.test(lower)) return icon;
  return Wrench;
}

function toolHint(request: ToolRequestedEvent): string {
  const args = request.arguments || {};
  const path = typeof args.path === "string" ? args.path : "";
  const command = typeof args.command === "string" ? args.command : "";
  const detail = path || command.split(" ").slice(0, 3).join(" ");
  return detail ? `${request.name} · ${detail}` : request.name;
}

function StatusDot({ tone }: { tone: "ok" | "bad" | "live" }) {
  return <i className={`bui-dot ${tone}`} aria-hidden="true" />;
}

function EditsChip({
  items,
  onOpenFile,
}: {
  items: FileEditEvent[];
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const additions = items.reduce((n, e) => n + (e.additions ?? 0), 0);
  const deletions = items.reduce((n, e) => n + (e.deletions ?? 0), 0);
  const continueRun = useWorkbench((state) => state.continueRun);
  const setCenterView = useWorkbench((state) => state.setCenterView);
  return (
    <section className={`bui-chip ${open ? "open" : ""}`}>
      <button type="button" className="bui-chip-head" onClick={() => setOpen((value) => !value)}>
        <CaretDown size={12} className="bui-caret" />
        <span className="bui-chip-label">改动</span>
        <span className="bui-chip-meta">
          {items.length} 个文件 · <span className="diff-add">+{additions}</span>{" "}
          <span className="diff-del">−{deletions}</span>
        </span>
      </button>
      {open && (
        <div className="bui-chip-body">
          {items.map((e) => (
            <button
              key={e.id}
              type="button"
              className="bui-file-row"
              onClick={() => onOpenFile(e.path)}
            >
              <span className={`edit-kind ${e.kind}`}>{e.kind}</span>
              <span className="edit-path">{e.path}</span>
              <span className="edit-diff">
                <span className="diff-add">+{e.additions ?? 0}</span>
                <span className="diff-del">−{e.deletions ?? 0}</span>
              </span>
            </button>
          ))}
          <div className="bui-chip-actions">
            <button type="button" className="bui-solid" onClick={() => void continueRun()}>
              采纳全部并继续
            </button>
            <button type="button" className="bui-ghost" onClick={() => setCenterView("diff")}>
              查看差异
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CheckpointsChip({ items }: { items: CheckpointCreatedEvent[] }) {
  const [open, setOpen] = useState(false);
  const previewCheckpoint = useWorkbench((state) => state.previewCheckpoint);
  return (
    <section className={`bui-chip ${open ? "open" : ""}`}>
      <button type="button" className="bui-chip-head" onClick={() => setOpen((value) => !value)}>
        <CaretDown size={12} className="bui-caret" />
        <span className="bui-chip-label">检查点</span>
        <span className="bui-chip-meta">{items.length} 个还原点</span>
      </button>
      {open && (
        <div className="bui-chip-body">
          {items.map((c, i) => (
            <div className={`cp-row ${i === items.length - 1 ? "latest" : ""}`} key={c.id}>
              <span className="cp-dot" />
              <span className="cp-id">{c.checkpointId}</span>
              <span className="cp-label">{c.label}</span>
              <span className="cp-time">{timeOf(c.ts)}</span>
              <button
                type="button"
                className="card-link"
                onClick={() => void previewCheckpoint(c.checkpointId)}
              >
                回滚到此
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Assistant prose. Settled content renders as markdown; while streaming, a
 * syntax-free trailing chunk renders word-by-word so the newest words land
 * tinted and settle into ink (assistant-ui streaming-text pattern).
 */
function Prose({ text, streaming }: { text: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > PROSE_PREVIEW_CHARS;
  const shown = expanded || !truncated ? text : previewText(text, PROSE_PREVIEW_CHARS);
  let head = shown;
  let tail = "";
  if (streaming) {
    const cut = plainTailCut(shown);
    if (cut > 0) {
      head = shown.slice(0, cut);
      tail = shown.slice(cut);
    }
  }
  return (
    <div className="bounded-content">
      <div className={`prose${streaming ? " streaming" : ""}`}>
        {head && <Markdown text={head} />}
        {tail && <StreamingWords text={tail} />}
        {streaming && <span className="stream-caret" aria-hidden="true" />}
      </div>
      {truncated && (
        <ExpandButton expanded={expanded} onClick={() => setExpanded((value) => !value)} />
      )}
    </div>
  );
}

/** Markdown that would change meaning if the tail rendered as plain text. */
function isPlainProse(text: string): boolean {
  return !/[`~#>*_[\]!|]/.test(text);
}

function plainTailCut(text: string): number {
  const paraStart = text.lastIndexOf("\n\n") + 2;
  if (isPlainProse(text.slice(paraStart))) {
    if (text.length - paraStart <= PLAIN_TAIL_MAX) return paraStart;
    const window = text.slice(text.length - PLAIN_TAIL_MAX);
    const space = window.indexOf(" ");
    if (space >= 0) return text.length - PLAIN_TAIL_MAX + space + 1;
  }
  return -1;
}

/** Words (latin) / characters (CJK) that fade in; the newest two stay tinted. */
const STREAM_TOKEN_RE = /(\s+)|([\u4e00-\u9fff\u3040-\u30ff])|([^\s\u4e00-\u9fff\u3040-\u30ff]+)/gu;

function StreamingWords({ text }: { text: string }) {
  const tokens = useMemo(
    () =>
      Array.from(text.matchAll(STREAM_TOKEN_RE), (match) => ({
        text: match[0],
        word: match[1] === undefined,
      })),
    [text],
  );
  const wordTotal = tokens.reduce((n, t) => n + (t.word ? 1 : 0), 0);
  let seen = 0;
  return (
    <span className="stream-words">
      {tokens.map((token, index) => {
        if (!token.word) return token.text;
        const fresh = seen++ >= wordTotal - 2;
        return (
          <span key={index} className={`sw${fresh ? " fresh" : ""}`}>
            {token.text}
          </span>
        );
      })}
    </span>
  );
}

function TerminalCard({ block }: { block: TerminalBlock }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const omitted = Math.max(0, block.lines.length - TERMINAL_PREVIEW_LINES);
  const lines = expanded ? block.lines : block.lines.slice(-TERMINAL_PREVIEW_LINES);
  const status =
    block.exit == null
      ? "执行中"
      : block.exit.exitCode === 0
        ? "完成"
        : `exit ${block.exit.exitCode}`;
  const tone = block.exit == null ? "live" : block.exit.exitCode === 0 ? "ok" : "bad";
  return (
    <section className={`bui-chip ${open ? "open" : ""}`}>
      <button type="button" className="bui-chip-head" onClick={() => setOpen((value) => !value)}>
        <CaretDown size={12} className="bui-caret" />
        <span className="bui-tool-icon">
          <TerminalWindow size={13} />
        </span>
        <span className="bui-chip-label">终端</span>
        <span className={`bui-chip-meta ${tone}`}>
          <StatusDot tone={tone as "ok" | "bad" | "live"} />
          {block.command} · {status}
        </span>
      </button>
      {open && (
        <div className="bui-chip-body">
          <pre className="term-out">
            <div className="cmd">$ {block.command}</div>
            {!expanded && omitted > 0 && (
              <div className="term-omitted">... 已折叠前 {omitted} 行 ...</div>
            )}
            {lines.map((line, index) => (
              <div key={expanded ? index : index + omitted} className={line.tone}>
                {line.text}
              </div>
            ))}
          </pre>
          {omitted > 0 && (
            <ExpandButton expanded={expanded} onClick={() => setExpanded((value) => !value)} />
          )}
        </div>
      )}
    </section>
  );
}

function ToolCard({ block }: { block: Extract<Block, { kind: "tool" }> }) {
  const [open, setOpen] = useState(!block.output);
  const ToolIcon = toolIcon(block.request.name);
  const args = useMemo(
    () => JSON.stringify(block.request.arguments, null, 2),
    [block.request.arguments],
  );
  const status = block.output ? (block.output.failed ? "失败" : "完成") : "执行中";
  const tone = block.output?.failed ? "bad" : block.output ? "ok" : "live";
  return (
    <section className={`bui-chip ${open ? "open" : ""}${block.output?.failed ? " failed" : ""}`}>
      <button type="button" className="bui-chip-head" onClick={() => setOpen((value) => !value)}>
        <CaretDown size={12} className="bui-caret" />
        <span className="bui-tool-icon">
          <ToolIcon size={13} />
        </span>
        <span className="bui-chip-label">{toolHint(block.request)}</span>
        <span className={`bui-chip-meta ${tone}`}>
          <StatusDot tone={tone} />
          {status}
        </span>
      </button>
      {open && (
        <div className="bui-chip-body">
          <ExpandablePre className="tool-args" text={args} />
          {block.output && (
            <ExpandablePre
              className={`tool-output ${block.output.failed ? "err" : ""}`}
              text={block.output.output}
            />
          )}
          {block.output && <CopyButton title="复制工具输出" text={block.output.output} />}
        </div>
      )}
    </section>
  );
}

function ExpandablePre({ className, text }: { className: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > TOOL_PREVIEW_CHARS;
  return (
    <div className="bounded-content">
      <pre className={className}>
        {expanded || !truncated ? text : previewText(text, TOOL_PREVIEW_CHARS)}
      </pre>
      {truncated && (
        <ExpandButton expanded={expanded} onClick={() => setExpanded((value) => !value)} />
      )}
    </div>
  );
}

function TableChip({ event }: { event: TableResultEvent }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? event.rows : event.rows.slice(0, TABLE_PREVIEW_ROWS);
  const truncated = event.rows.length > TABLE_PREVIEW_ROWS;
  return (
    <section className="bui-chip open">
      <div className="bui-chip-head static">
        <span className="bui-chip-label">表格</span>
        {event.caption && <span className="bui-chip-meta">{event.caption}</span>}
      </div>
      <div className="bui-chip-body">
        <table>
          <thead>
            <tr>
              {event.columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {event.columns.map((column) => (
                  <td key={column.key} className={cellClass(row[column.key])}>
                    {renderCell(String(row[column.key] ?? ""))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {truncated && (
          <ExpandButton
            expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            detail={`${event.rows.length} 行`}
          />
        )}
      </div>
    </section>
  );
}

/** Copy-to-clipboard affordance that confirms in place rather than via a toast. */
function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy-btn ${copied ? "done" : ""}`}
      title={title}
      aria-label={title}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? <Check size={11} weight="bold" /> : <Copy size={11} />}
    </button>
  );
}

function ExpandButton({
  expanded,
  onClick,
  detail,
}: {
  expanded: boolean;
  onClick: () => void;
  detail?: string;
}) {
  return (
    <div className="bounded-content-actions">
      <button type="button" className="card-link" onClick={onClick}>
        {expanded ? "收起" : `展开全部${detail ? ` (${detail})` : ""}`}
      </button>
    </div>
  );
}

function previewText(text: string, limit: number): string {
  const tailLength = Math.floor(limit / 4);
  const headLength = limit - tailLength;
  return `${text.slice(0, headLength)}\n\n... 已折叠 ${text.length - limit} 个字符 ...\n\n${text.slice(-tailLength)}`;
}

function timeOf(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function UserBubble({
  id,
  text,
  ts,
  query,
  canEdit,
  activeHit,
  onEdit,
  onFork,
}: {
  id: string;
  text: string;
  ts?: string;
  query?: string;
  canEdit?: boolean;
  activeHit?: boolean;
  onEdit: (text: string) => void;
  onFork?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  useEffect(() => {
    setValue(text);
  }, [text]);
  useEffect(() => {
    if (activeHit) ref.current?.scrollIntoView({ block: "center" });
  }, [activeHit]);
  return (
    <div className={`turn user ${activeHit ? "find-hit" : ""}`} data-turn={id} ref={ref}>
      {editing ? (
        <div className="bubble-user editing">
          <textarea
            value={value}
            autoFocus
            rows={Math.max(1, Math.min(8, value.split("\n").length))}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
                setValue(text);
              }
            }}
          />
          <div className="bubble-edit-actions">
            <button type="button" className="msg-action-btn" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              type="button"
              className="msg-action-btn solid"
              disabled={!value.trim()}
              title="保存后填入输入框，可直接发送"
              onClick={() => {
                setEditing(false);
                onEdit(value.trim() || text);
              }}
            >
              <Check size={11} weight="bold" />
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="bubble-user">{highlightText(text, query)}</div>
      )}
      {(canEdit || ts || onFork) && !editing && (
        <div className="msg-actions">
          {ts && <span className="msg-time">{timeOf(ts)}</span>}
          {canEdit && (
            <button type="button" className="msg-action-btn" onClick={() => setEditing(true)}>
              <PencilSimple size={11} />
              编辑
            </button>
          )}
          {onFork && (
            <button
              type="button"
              className="msg-action-btn"
              title="复制到此条为止的对话到新会话，原会话不受影响"
              onClick={onFork}
            >
              <GitFork size={11} />
              从此处分叉
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function highlightText(text: string, query?: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let from = lower.indexOf(query, cursor);
  let key = 0;
  while (from >= 0) {
    if (from > cursor) parts.push(text.slice(cursor, from));
    parts.push(
      <mark key={key} className="find-mark">
        {text.slice(from, from + query.length)}
      </mark>,
    );
    key += 1;
    cursor = from + query.length;
    from = lower.indexOf(query, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function cellClass(value: unknown): string {
  const text = String(value ?? "");
  if (/^[-+]?\d+(\.\d+)?%?$/.test(text)) {
    return `num ${text.startsWith("-") ? "neg" : text.startsWith("+") ? "pos" : ""}`.trim();
  }
  return "";
}

const FLAG_TONE: Record<string, string> = {
  待确认: "warn",
  异常: "bad",
  正向: "ok",
  正常: "ok",
};

function renderCell(text: string) {
  const tone = FLAG_TONE[text];
  if (tone) return <span className={`flag ${tone}`}>{text}</span>;
  return text;
}
