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
} from "@her-dock/agent-protocol";
import { useWorkbench } from "../store/workbench";
import { IconChevronRight } from "./Icons";

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
  | { kind: "error"; id: string; message: string };

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
      case "message.assistant":
        blocks.push({ kind: "prose", id: e.id, text: e.text });
        break;
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
        if (last && last.kind === "terminal") {
          for (const line of out.text.split("\n")) {
            if (line === "") continue;
            last.lines.push({ text: line, tone: out.stream === "stderr" ? "err" : "" });
          }
        }
        break;
      }
      case "shell.exit":
        if (last && last.kind === "terminal") last.exit = e as ShellExitEvent;
        break;
      case "file.edit_proposed":
      case "file.edit_applied":
        if (last && last.kind === "edits") last.items.push(e as FileEditEvent);
        else blocks.push({ kind: "edits", id: e.id, items: [e as FileEditEvent] });
        break;
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
  const s = useWorkbench();
  const turns = buildTurns(events);
  const relatedRuns = s.runs.filter((r) => r.id !== s.run?.id).slice(0, 3);

  if (!turns.length) {
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
            <button type="button" className="card-link" onClick={() => s.setCenterView("activity")}>
              查看全部
            </button>
          </header>
          {relatedRuns.map((r) => (
            <button
              key={r.id}
              type="button"
              className="related-row"
              onClick={() => void s.selectSession(r.sessionId)}
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
    </div>
  );
}

function BlockView({ block, onOpenFile }: { block: Block; onOpenFile: (p: string) => void }) {
  const s = useWorkbench();

  switch (block.kind) {
    case "prose":
      return <div className="prose">{block.text}</div>;

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
                  {step.state === "done" ? "✓" : step.state === "running" ? "·" : ""}
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
            {block.lines.map((l, i) => (
              <div key={i} className={l.tone}>
                {l.text}
              </div>
            ))}
          </pre>
        </section>
      );

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
            <button key={e.id} type="button" className="edit-row" onClick={() => onOpenFile(e.path)}>
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
              onClick={() => void s.continueRun()}
            >
              采纳全部并继续
            </button>
            <button type="button" className="ghost-btn" onClick={() => s.setCenterView("diff")}>
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
            </div>
          ))}
        </section>
      );

    case "table":
      return (
        <section className="card">
          <header>
            <span className="card-tag">TABLE</span>
            {block.ev.caption && <span className="card-meta right">{block.ev.caption}</span>}
          </header>
          <table>
            <thead>
              <tr>
                {block.ev.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.ev.rows.map((row, i) => (
                <tr key={i}>
                  {block.ev.columns.map((c) => (
                    <td key={c.key} className={cellClass(row[c.key])}>
                      {renderCell(String(row[c.key] ?? ""))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );

    case "decision": {
      const answered = s.answeredDecisions[block.id] || block.ev.selectedOptionId;
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
                  onClick={() => void s.answerDecision(block.id, o.id, o.label)}
                >
                  {o.label}
                </button>
              ))}
              <button
                type="button"
                className="link"
                onClick={() => s.setDraft(`关于「${block.ev.question}」：`)}
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
