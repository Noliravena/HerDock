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
import { Check, CircleNotch } from "@phosphor-icons/react";
import { memo, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../store/workbench";
import { IconChevronRight } from "./Icons";

const TERMINAL_PREVIEW_LINES = 400;
const PROSE_PREVIEW_CHARS = 40_000;
const TOOL_PREVIEW_CHARS = 20_000;
const TABLE_PREVIEW_ROWS = 200;

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
  | { kind: "error"; id: string; message: string }
  | { kind: "tool"; id: string; request: ToolRequestedEvent; output?: ToolOutputEvent };

type AgentTurn = { role: "agent"; id: string; blocks: Block[] };
type Turn = { role: "user"; id: string; text: string } | AgentTurn;

/** Fold the flat event stream into user bubbles and agent turns of design cards. */
function buildTurns(events: AgentEvent[]): Turn[] {
  const turns: Turn[] = [];
  let agent: AgentTurn | undefined;

  for (const e of events) {
    if (e.type === "message.user") {
      agent = undefined;
      turns.push({ role: "user", id: e.id, text: e.text });
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
      case "error":
        blocks.push({
          kind: "error",
          id: e.id,
          message: String((e as { message?: string }).message || "运行出错"),
        });
        break;
      default:
        break;
    }
  }
  return turns.filter((t) => t.role === "user" || t.blocks.length > 0);
}

export function Thread({
  events,
  onOpenFile,
}: {
  events: AgentEvent[];
  onOpenFile: (path: string) => void;
}) {
  const {
    checkpointPreview,
    hasEarlierEvents,
    loadingEarlierEvents,
    loadEarlierEvents,
    restoreCheckpoint,
    run,
    runs,
    selectRun,
    setCenterView,
  } = useWorkbench(
    useShallow((state) => ({
      checkpointPreview: state.checkpointPreview,
      hasEarlierEvents: state.hasEarlierEvents,
      loadingEarlierEvents: state.loadingEarlierEvents,
      loadEarlierEvents: state.loadEarlierEvents,
      restoreCheckpoint: state.restoreCheckpoint,
      run: state.run,
      runs: state.runs,
      selectRun: state.selectRun,
      setCenterView: state.setCenterView,
    })),
  );
  const turns = useMemo(() => buildTurns(events), [events]);
  const relatedRuns = runs.filter((item) => item.id !== run?.id).slice(0, 3);

  if (!turns.length && !run) {
    return (
      <div className="thread">
        <div className="empty-hint">
          还没有事件。描述一个任务并发送，Agent 的计划、终端、改动与结论会以卡片形式出现在这里。
        </div>
      </div>
    );
  }

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
            {loadingEarlierEvents ? "正在加载..." : "加载更早内容"}
          </button>
          <span>当前显示 {events.length} 条事件</span>
        </div>
      )}
      {run?.prompt && !turns.some((turn) => turn.role === "user") && (
        <div className="turn user">
          <div className="bubble-user">{run.prompt}</div>
        </div>
      )}
      {turns.map((turn) =>
        turn.role === "user" ? (
          <div className="turn user" key={turn.id}>
            <div className="bubble-user">{turn.text}</div>
          </div>
        ) : (
          <div className="turn" key={turn.id}>
            <span className="agent-avatar">行</span>
            <div className="turn-body">
              {turn.blocks.map((b) => (
                <BlockView key={b.id} block={b} onOpenFile={onOpenFile} />
              ))}
            </div>
          </div>
        ),
      )}

      {relatedRuns.length > 0 && (
        <section className="card">
          <header>
            <span className="card-tag">RELATED RUNS</span>
            <button type="button" className="card-link" onClick={() => setCenterView("activity")}>
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
                {r.providerId} · {r.planProgress || r.status}
              </span>
            </button>
          ))}
        </section>
      )}

      {checkpointPreview && (
        <div
          className="checkpoint-backdrop"
          role="presentation"
          onMouseDown={() => useWorkbench.setState({ checkpointPreview: null })}
        >
          <section
            className="checkpoint-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="检查点预览"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <b>恢复检查点</b>
                <span>
                  {checkpointPreview.scope === "workspace" ? "工作区快照" : "文件快照"} ·{" "}
                  {checkpointPreview.files.length} 个变更
                </span>
              </div>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => useWorkbench.setState({ checkpointPreview: null })}
              >
                关闭
              </button>
            </header>
            <div className="checkpoint-files">
              {checkpointPreview.files.map((file) => (
                <details key={file.path}>
                  <summary>
                    <span className={`edit-kind ${file.kind === "deleted" ? "D" : "M"}`}>
                      {file.kind === "deleted" ? "D" : "M"}
                    </span>
                    {file.path}
                  </summary>
                  {file.diff ? (
                    <pre>{file.diff}</pre>
                  ) : (
                    <div className="empty-hint">二进制文件或无文本 Diff</div>
                  )}
                </details>
              ))}
              {!checkpointPreview.files.length && (
                <div className="empty-hint">当前工作区与该检查点一致，无需恢复。</div>
              )}
            </div>
            <footer>
              <span>恢复会保留运行前已存在的工作区改动。</span>
              <button
                type="button"
                className="primary-btn"
                disabled={!checkpointPreview.files.length}
                onClick={() => {
                  const id = checkpointPreview.checkpointId;
                  if (id && window.confirm("确认恢复此检查点？当前运行产生的更改会被还原。"))
                    void restoreCheckpoint(id).then(() =>
                      useWorkbench.setState({ checkpointPreview: null }),
                    );
                }}
              >
                确认恢复
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

const BlockView = memo(function BlockView({
  block,
  onOpenFile,
}: {
  block: Block;
  onOpenFile: (p: string) => void;
}) {
  const {
    answerDecision,
    answeredDecisions,
    continueRun,
    previewCheckpoint,
    setCenterView,
    setDraft,
  } = useWorkbench(
    useShallow((state) => ({
      answerDecision: state.answerDecision,
      answeredDecisions: state.answeredDecisions,
      continueRun: state.continueRun,
      previewCheckpoint: state.previewCheckpoint,
      setCenterView: state.setCenterView,
      setDraft: state.setDraft,
    })),
  );

  switch (block.kind) {
    case "prose":
      return <ExpandableProse text={block.text} />;

    case "plan": {
      const done = block.steps.filter((x) => x.state === "done").length;
      return (
        <section className="card">
          <header>
            <span className="card-tag">PLAN</span>
            <span className="card-meta right warn">
              {done}/{block.steps.length}
            </span>
          </header>
          <div className="card-body">
            {block.steps.map((step) => (
              <div className={`plan-step ${step.state}`} key={step.id}>
                <span className={`step-mark ${step.state}`}>
                  {step.state === "done" ? (
                    <Check size={9} weight="bold" />
                  ) : step.state === "running" ? (
                    <CircleNotch size={9} weight="bold" />
                  ) : null}
                </span>
                <span className="title">{step.title}</span>
                <span className="dur">
                  {step.durationMs != null
                    ? `${(step.durationMs / 1000).toFixed(1)}s`
                    : step.state === "pending"
                      ? "待执行"
                      : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      );
    }

    case "terminal":
      return <TerminalCard block={block} />;

    case "tool":
      return <ToolCard block={block} />;

    case "edits": {
      const additions = block.items.reduce((n, e) => n + (e.additions ?? 0), 0);
      const deletions = block.items.reduce((n, e) => n + (e.deletions ?? 0), 0);
      return (
        <section className="card">
          <header>
            <span className="card-tag">EDITS</span>
            <span className="card-meta right ok">
              +{additions} −{deletions}
            </span>
          </header>
          {block.items.map((e) => (
            <button
              key={e.id}
              type="button"
              className="edit-row"
              onClick={() => onOpenFile(e.path)}
            >
              <span className={`edit-kind ${e.kind}`}>{e.kind}</span>
              <span className="edit-path">{e.path}</span>
              <span className="edit-diff">
                +{e.additions ?? 0} −{e.deletions ?? 0}
              </span>
              <IconChevronRight />
            </button>
          ))}
          <div className="card-actions">
            <button
              type="button"
              className="primary-btn"
              title="以磁盘上的当前内容继续运行（磁盘优先）"
              onClick={() => void continueRun()}
            >
              采纳全部并继续
            </button>
            <button type="button" className="ghost-btn" onClick={() => setCenterView("diff")}>
              查看差异
            </button>
          </div>
        </section>
      );
    }

    case "checkpoints":
      return (
        <section className="card">
          <header>
            <span className="card-tag">CHECKPOINTS</span>
            <span className="card-meta right">{block.items.length}</span>
          </header>
          {block.items.map((c, i) => (
            <div className={`cp-row ${i === block.items.length - 1 ? "latest" : ""}`} key={c.id}>
              <span className="cp-dot" />
              <span className="cp-id">{c.checkpointId}</span>
              <span className="cp-label">{c.label}</span>
              <span className="cp-time">{timeOf(c.ts)}</span>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void previewCheckpoint(c.checkpointId)}
              >
                预览
              </button>
            </div>
          ))}
        </section>
      );

    case "table":
      return <TableCard event={block.ev} />;

    case "decision": {
      const answered = answeredDecisions[block.id] || block.ev.selectedOptionId;
      return (
        <section className="decision">
          <div className="decision-head">
            <i />
            <span>需要你决定</span>
          </div>
          <p>{block.ev.question}</p>
          {answered ? (
            <div className="decision-answered">已回复：{answered}</div>
          ) : (
            <div className="decision-actions">
              {block.ev.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={o.primary ? "primary" : ""}
                  onClick={() => void answerDecision(block.id, o.id, o.label)}
                >
                  {o.label}
                </button>
              ))}
              <button
                type="button"
                className="link"
                onClick={() => setDraft(`关于「${block.ev.question}」：`)}
              >
                我自己写一条
              </button>
            </div>
          )}
        </section>
      );
    }

    case "error":
      return (
        <section className="card error">
          <header>
            <span className="card-tag">ERROR</span>
          </header>
          <p className="error-text">{block.message}</p>
        </section>
      );
  }
});

function ExpandableProse({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > PROSE_PREVIEW_CHARS;
  return (
    <div className="bounded-content">
      <div className="prose">
        {expanded || !truncated ? text : previewText(text, PROSE_PREVIEW_CHARS)}
      </div>
      {truncated && (
        <ExpandButton expanded={expanded} onClick={() => setExpanded((value) => !value)} />
      )}
    </div>
  );
}

function TerminalCard({ block }: { block: TerminalBlock }) {
  const [expanded, setExpanded] = useState(false);
  const omitted = Math.max(0, block.lines.length - TERMINAL_PREVIEW_LINES);
  const lines = expanded ? block.lines : block.lines.slice(-TERMINAL_PREVIEW_LINES);
  return (
    <section className="card">
      <header>
        <span className="card-tag">TERMINAL</span>
        <span className="card-meta">{block.command}</span>
        {block.exit && (
          <span className={`card-meta right ${block.exit.exitCode === 0 ? "ok" : "bad"}`}>
            exit {block.exit.exitCode}
            {block.exit.durationMs != null
              ? ` · ${(block.exit.durationMs / 1000).toFixed(1)}s`
              : ""}
          </span>
        )}
      </header>
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
    </section>
  );
}

function ToolCard({ block }: { block: Extract<Block, { kind: "tool" }> }) {
  const args = useMemo(
    () => JSON.stringify(block.request.arguments, null, 2),
    [block.request.arguments],
  );
  return (
    <section className="card tool-card">
      <header>
        <span className="card-tag">TOOL</span>
        <span className="card-meta">{block.request.name}</span>
        <span
          className={`card-meta right ${block.output?.failed ? "bad" : block.output ? "ok" : "warn"}`}
        >
          {block.output ? (block.output.failed ? "失败" : "完成") : "执行中"}
        </span>
      </header>
      <ExpandablePre className="tool-args" text={args} />
      {block.output && (
        <ExpandablePre
          className={`tool-output ${block.output.failed ? "err" : ""}`}
          text={block.output.output}
        />
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

function TableCard({ event }: { event: TableResultEvent }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? event.rows : event.rows.slice(0, TABLE_PREVIEW_ROWS);
  const truncated = event.rows.length > TABLE_PREVIEW_ROWS;
  return (
    <section className="card">
      <header>
        <span className="card-tag">TABLE</span>
        {event.caption && <span className="card-meta right">{event.caption}</span>}
      </header>
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
    </section>
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
