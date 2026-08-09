import { useWorkbench } from "../store/workbench";
import { formatTokens } from "./RightPanel";

export function StatusBar() {
  const s = useWorkbench();
  const run = s.run;
  const live = run ? ["running", "starting"].includes(run.status) : false;
  const tokens = s.usage?.context.used ?? 0;
  const limit = s.usage?.context.limit ?? 200000;

  return (
    <footer className="status">
      {s.queueOpen && (
        <div className="queue-pop">
          <header>
            RUN QUEUE
            <span className="n">{s.queue.length}</span>
          </header>
          {s.queue.map((q) => (
            <div className="queue-row" key={q.runId}>
              <span className={`run-dot ${q.status}`} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="name">{q.name}</div>
                <div className="meta">{q.meta}</div>
              </div>
            </div>
          ))}
          {!s.queue.length && <div className="empty-hint">队列为空。</div>}
        </div>
      )}

      <button type="button" className="queue-btn" onClick={s.toggleQueue}>
        <span className={`run-dot ${run?.status || "idle"}`} style={live ? undefined : { animation: "none" }} />
        {run ? `${run.id} · ${run.planProgress || run.status}` : "idle"} · 队列 {s.queue.length}
      </button>

      <span>
        {s.workspace?.name || "no workspace"}
        {s.workspace?.branch ? ` · ${s.workspace.branch}` : ""}
      </span>
      {s.workspace?.dirtySummary && <span>{s.workspace.dirtySummary} 未采纳</span>}
      {s.platform.desktop && s.workspace?.rootPath && (
        <span className="local">本地文件夹 {s.workspace.rootPath}</span>
      )}

      <span className="grow" />
      <span>
        {formatTokens(tokens)} / {formatTokens(limit)} tokens
      </span>
      <span>{(s.usage?.credits ?? 0).toLocaleString()} credits</span>
      <span>{s.hostOnline ? "local host" : "fixture"}</span>
      {s.error && <span className="err">{s.error}</span>}
    </footer>
  );
}
