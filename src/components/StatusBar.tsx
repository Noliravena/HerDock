import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../store/workbench";
import { formatTokens } from "./RightPanel";

export function StatusBar() {
  const {
    error,
    hostOnline,
    platform,
    providers,
    queue,
    queueOpen,
    run,
    toggleQueue,
    usage,
    workspace,
  } = useWorkbench(
    useShallow((state) => ({
      error: state.error,
      hostOnline: state.hostOnline,
      platform: state.platform,
      providers: state.providers,
      queue: state.queue,
      queueOpen: state.queueOpen,
      run: state.run,
      toggleQueue: state.toggleQueue,
      usage: state.usage,
      workspace: state.workspace,
    })),
  );
  const live = run ? ["running", "starting"].includes(run.status) : false;
  const tokens = usage?.context.used ?? 0;
  const limit = usage?.context.limit ?? 200000;

  return (
    <footer className="status">
      {queueOpen && (
        <div className="queue-pop">
          <header>
            RUN QUEUE
            <span className="n">{queue.length}</span>
          </header>
          {queue.map((q) => (
            <div className="queue-row" key={q.runId}>
              <span className={`run-dot ${q.status}`} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="name">{q.name}</div>
                <div className="meta">{q.meta}</div>
              </div>
            </div>
          ))}
          {!queue.length && <div className="empty-hint">队列为空。</div>}
        </div>
      )}

      <button type="button" className="queue-btn" onClick={toggleQueue}>
        <span
          className={`run-dot ${run?.status || "idle"}`}
          style={live ? undefined : { animation: "none" }}
        />
        {run ? `${run.id} · ${run.planProgress || run.status}` : "idle"} · 队列 {queue.length}
      </button>

      <span>
        {workspace?.name || "no workspace"}
        {workspace?.branch ? ` · ${workspace.branch}` : ""}
      </span>
      {workspace?.dirtySummary && <span>{workspace.dirtySummary} 未采纳</span>}
      {platform.desktop && workspace?.rootPath && (
        <span className="local">本地文件夹 {workspace.rootPath}</span>
      )}

      <span className="grow" />
      <span>
        {formatTokens(tokens)} / {formatTokens(limit)} tokens
      </span>
      <span>{providers.filter((provider) => provider.available).length} Provider</span>
      <span>{hostOnline ? "本地核心" : "核心离线"}</span>
      {error && <span className="err">{error}</span>}
    </footer>
  );
}
