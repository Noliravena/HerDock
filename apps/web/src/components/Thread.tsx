import type {
  AgentEvent,
  FileEditEvent,
  HumanDecisionEvent,
  PlanUpdatedEvent,
  ShellExitEvent,
  ShellOutputEvent,
  ShellStartEvent,
  TableResultEvent,
} from "@her-dock/agent-protocol";

export function Thread({
  events,
  onOpenFile,
}: {
  events: AgentEvent[];
  onOpenFile: (path: string) => void;
}) {
  const plan = [...events].reverse().find((e): e is PlanUpdatedEvent => e.type === "plan.updated");
  const shells = groupShell(events);
  const edits = events.filter((e): e is FileEditEvent => e.type === "file.edit_proposed" || e.type === "file.edit_applied");
  const tables = events.filter((e): e is TableResultEvent => e.type === "table.result");
  const decisions = events.filter((e): e is HumanDecisionEvent => e.type === "human.decision");
  const messages = events.filter(
    (e): e is Extract<AgentEvent, { type: "message.user" | "message.assistant" }> =>
      e.type === "message.user" || e.type === "message.assistant",
  );
  const checkpoints = events.filter((e) => e.type === "checkpoint.created");
  const errors = events.filter((e) => e.type === "error");

  return (
    <div className="thread">
      {messages.map((m) => (
        <div key={m.id} className={`bubble ${m.type === "message.user" ? "user" : "assistant"}`}>
          {m.text}
        </div>
      ))}
      {plan && (
        <section className="card-block">
          <header>
            <span className="tag">PLAN</span>
            <span className="meta">
              {plan.steps.filter((s) => s.state === "done").length}/{plan.steps.length}
            </span>
          </header>
          <ul className="plan-list">
            {plan.steps.map((s) => (
              <li key={s.id} data-state={s.state}>
                <span className="mark">{s.state === "done" ? "✓" : s.state === "running" ? "·" : ""}</span>
                <span>{s.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {shells.map((g) => (
        <section key={g.key} className="card-block">
          <header>
            <span className="tag">TERMINAL</span>
            <span className="meta mono">{g.command}</span>
            {g.exit && (
              <span className={`meta ${g.exit.exitCode === 0 ? "ok" : "bad"}`}>
                exit {g.exit.exitCode}
                {g.exit.durationMs != null ? ` · ${(g.exit.durationMs / 1000).toFixed(1)}s` : ""}
              </span>
            )}
          </header>
          {g.output && <pre className="term-out">{g.output}</pre>}
        </section>
      ))}
      {edits.length > 0 && (
        <section className="card-block">
          <header>
            <span className="tag">EDITS</span>
            <span className="meta ok">
              +{edits.reduce((n, e) => n + (e.additions ?? 0), 0)} −
              {edits.reduce((n, e) => n + (e.deletions ?? 0), 0)}
            </span>
          </header>
          <ul className="edit-list">
            {edits.map((e) => (
              <li key={e.id} onClick={() => onOpenFile(e.path)} className="clickable">
                <span className="kind">{e.kind}</span>
                <span className="mono path">{e.path}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {checkpoints.length > 0 && (
        <section className="card-block">
          <header>
            <span className="tag">CHECKPOINTS</span>
            <span className="meta">{checkpoints.length}</span>
          </header>
          <ul className="edit-list">
            {checkpoints.map((c) => (
              <li key={c.id}>
                <span className="mono path">{String((c as { label?: string }).label || c.id)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tables.map((t) => (
        <section key={t.id} className="card-block">
          <header>
            <span className="tag">TABLE</span>
            {t.caption && <span className="meta">{t.caption}</span>}
          </header>
          <table>
            <thead>
              <tr>
                {t.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, i) => (
                <tr key={i}>
                  {t.columns.map((c) => (
                    <td key={c.key}>{String(row[c.key] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {decisions.map((d) => (
        <section key={d.id} className="card-block decision">
          <header>
            <span className="dot" />
            <span className="title">需要你决定</span>
          </header>
          <p>{d.question}</p>
          <div className="actions">
            {d.options.map((o) => (
              <button key={o.id} type="button" className={o.primary ? "primary" : ""}>
                {o.label}
              </button>
            ))}
          </div>
        </section>
      ))}
      {errors.map((e) => (
        <section key={e.id} className="card-block error">
          <header>
            <span className="tag">ERROR</span>
          </header>
          <p className="error-text">{String((e as { message?: string }).message)}</p>
        </section>
      ))}
    </div>
  );
}

function groupShell(events: AgentEvent[]) {
  const groups: {
    key: string;
    command: string;
    output: string;
    exit?: ShellExitEvent;
  }[] = [];
  let cur: (typeof groups)[0] | null = null;
  for (const e of events) {
    if (e.type === "shell.start") {
      const s = e as ShellStartEvent;
      cur = { key: e.id, command: s.command, output: "" };
      groups.push(cur);
    } else if (e.type === "shell.output" && cur) {
      cur.output += (e as ShellOutputEvent).text;
    } else if (e.type === "shell.exit" && cur) {
      cur.exit = e as ShellExitEvent;
      cur = null;
    }
  }
  return groups;
}
