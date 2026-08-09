import { useEffect } from "react";
import { APP_DISPLAY_NAME } from "@her-dock/shared";
import { Thread } from "./components/Thread";
import { FileTree } from "./components/FileTree";
import { EditorPane } from "./components/EditorPane";
import { useWorkbench } from "./store/workbench";

const QUICK = {
  coding: [
    { label: "解释这段改动", text: "解释当前工作区未提交改动的意图与风险" },
    { label: "补测试", text: "为最近修改补单元测试并运行" },
    { label: "跑回归", text: "运行项目测试并修复失败项" },
  ],
  analysis: [
    { label: "异常排查", text: "读取 data/ 与 rules/，找出异常并输出到 out/" },
    { label: "写周报", text: "根据 out/ 与本次 run 结果写成周报 Markdown" },
    { label: "交叉核对", text: "与促销/日历数据交叉核对异常原因" },
  ],
  mixed: [
    { label: "解释改动", text: "解释当前改动" },
    { label: "异常分析", text: "分析 data/ 异常并写脚本到 agents/" },
    { label: "补测试", text: "为改动补测试" },
  ],
};

export function App() {
  const s = useWorkbench();

  useEffect(() => {
    void s.init();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.togglePalette();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void s.saveFile();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void s.sendPrompt();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openWorkspace = () => {
    const path = window.prompt(
      "输入本地工作区绝对路径（Host 将挂载该目录）",
      s.workspace?.rootPath || "C:\\\\Users\\\\Vantiboolean\\\\Documents\\\\DevelopeGithub\\\\her-dock",
    );
    if (path) void s.openWorkspacePath(path);
  };

  return (
    <div className={`shell ${s.rightOpen ? "" : "no-right"}`}>
      <aside className="left">
        <div className="brand">
          <div className="logo">行</div>
          <div>
            <div className="brand-name">行知</div>
            <div className="brand-sub">开发者模式</div>
          </div>
        </div>
        <button type="button" className="nav-item" onClick={() => void s.newSession()}>
          新建会话
          <span className="hint">⌘N</span>
        </button>
        <button
          type="button"
          className={`nav-item ${s.centerView === "activity" ? "active" : ""}`}
          onClick={() => s.setCenterView("activity")}
        >
          活动
          <span className="hint">{s.runs.length || ""}</span>
        </button>

        <div className="section-label">
          <span>工作区</span>
          <button type="button" className="icon-btn" onClick={openWorkspace} title="打开文件夹">
            +
          </button>
        </div>
        <div className="ws-block">
          <div className="ws-head">
            <span className="ws-dot" />
            <span className="ws-name">{s.workspace?.name || "未打开"}</span>
            <span className="ws-diff">{s.workspace?.dirtySummary}</span>
          </div>
          <div className="session-list">
            {s.sessions.map((sess) => (
              <button
                key={sess.id}
                type="button"
                className={`session-row ${s.session?.id === sess.id ? "active" : ""}`}
                onClick={() => void s.selectSession(sess.id)}
              >
                {sess.title}
              </button>
            ))}
            {!s.sessions.length && <div className="empty-hint">暂无会话</div>}
          </div>
        </div>

        <div className="nav-bottom">
          <button type="button" className="nav-item" onClick={() => s.setSideTab("skills")}>
            技能
          </button>
          <button type="button" className="nav-item" onClick={() => s.setSideTab("approvals")}>
            连接器/审批
            {s.approvals.length > 0 && <span className="badge-n">{s.approvals.length}</span>}
          </button>
          <button type="button" className="nav-item" onClick={() => s.setSideTab("artifacts")}>
            产物库
          </button>
        </div>

        <div className="user-card">
          <div className="avatar">开</div>
          <div>
            <div className="user-name">{APP_DISPLAY_NAME}</div>
            <div className="user-meta">{s.hostOnline ? "Host 在线" : "离线 fixture"}</div>
          </div>
        </div>
      </aside>

      <section className="center">
        <div className="tabs">
          {(
            [
              ["chat", s.session?.title || "会话"],
              ["code", s.openFile?.split("/").pop() || "代码"],
              ["diff", "差异"],
              ["activity", "活动"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`tab ${s.centerView === k ? "active" : ""}`}
              onClick={() => s.setCenterView(k)}
            >
              {label}
              {k === "code" && s.dirty ? <span className="dirty" /> : null}
            </button>
          ))}
          <div className="tabs-right">
            <span className="run-pill">
              {s.run ? `${s.run.id} · ${s.run.status}` : "idle"}
            </span>
            <button type="button" className="icon-btn" onClick={s.toggleRight} title="切换右侧栏">
              ▤
            </button>
          </div>
        </div>

        {s.centerView === "chat" && (
          <div className="chat-view">
            <div className="chat-toolbar">
              <div>
                <div className="chat-title">{s.session?.title || "新会话"}</div>
                <div className="chat-meta mono">
                  {s.run?.id || "—"} · {s.workspace?.name || "—"} · {s.providerId}
                  {s.demoMode ? " · demo" : ""}
                </div>
              </div>
              <div className="toolbar-actions">
                <button type="button" onClick={s.togglePalette}>
                  命令 ⌘K
                </button>
                <button type="button" onClick={() => void s.cancelRun()}>
                  暂停/取消
                </button>
                <button type="button" className="primary" onClick={() => void s.continueRun()}>
                  Continue Run
                </button>
              </div>
            </div>
            <div className="chat-scroll">
              <Thread events={s.events} onOpenFile={(p) => void s.openPath(p)} />
            </div>
            <div className="composer">
              <div className="quick">
                {QUICK[s.kind].map((q) => (
                  <button key={q.label} type="button" onClick={() => s.setDraft(q.text)}>
                    {q.label}
                  </button>
                ))}
              </div>
              <div className="composer-row">
                <select value={s.kind} onChange={(e) => s.setKind(e.target.value as typeof s.kind)}>
                  <option value="mixed">混合</option>
                  <option value="coding">Coding</option>
                  <option value="analysis">分析</option>
                </select>
                <select value={s.providerId} onChange={(e) => s.setProviderId(e.target.value)}>
                  {s.providers.length
                    ? s.providers.map((p) => (
                        <option key={p.id} value={p.id} disabled={!p.available}>
                          {p.id}
                          {!p.available ? " (missing)" : ""}
                        </option>
                      ))
                    : ["codex", "claude", "grok"].map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                </select>
                <select value={s.autoExecute} onChange={(e) => s.setAutoExecute(e.target.value)}>
                  <option value="ask_always">始终询问</option>
                  <option value="ask_risky">风险询问</option>
                  <option value="auto_workspace">工作区自动</option>
                  <option value="auto_all">尽量自动</option>
                </select>
                <label className="demo-toggle">
                  <input
                    type="checkbox"
                    checked={s.demoMode}
                    onChange={(e) => s.setDemoMode(e.target.checked)}
                  />
                  Demo
                </label>
              </div>
              <textarea
                value={s.draft}
                onChange={(e) => s.setDraft(e.target.value)}
                placeholder="描述任务… 人手改文件后点 Continue Run（磁盘优先）"
                rows={3}
              />
              <div className="composer-actions">
                <button type="button" onClick={() => void s.saveFile()} disabled={!s.dirty}>
                  保存文件 ⌘S
                </button>
                <button type="button" className="primary" onClick={() => void s.sendPrompt()}>
                  发送 ⌘⏎
                </button>
              </div>
            </div>
          </div>
        )}

        {s.centerView === "code" && (
          <div className="code-view">
            <div className="code-toolbar">
              <button type="button" onClick={() => void s.saveFile()} disabled={!s.dirty}>
                保存 {s.dirty ? "●" : ""}
              </button>
              <button type="button" onClick={() => s.setCenterView("diff")}>
                查看差异
              </button>
              <button type="button" className="primary" onClick={() => void s.continueRun()}>
                保存后 Continue
              </button>
            </div>
            <EditorPane
              path={s.openFile}
              value={s.fileContent}
              onChange={s.setFileContent}
              readOnly={!s.hostOnline && !!s.openFile}
            />
          </div>
        )}

        {s.centerView === "diff" && <DiffView />}
        {s.centerView === "activity" && <ActivityView />}
      </section>

      {s.rightOpen && (
        <aside className="right">
          <div className="side-tabs">
            {(
              [
                ["workspace", "工作区"],
                ["approvals", `审批 ${s.approvals.length || ""}`.trim()],
                ["context", "上下文"],
                ["skills", "技能"],
                ["artifacts", "产物"],
                ["cost", "策略"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={s.sideTab === k ? "active" : ""}
                onClick={() => s.setSideTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="side-body">
            {s.sideTab === "workspace" && (
              <>
                <div className="side-meta mono">
                  {s.workspace?.name} · {s.workspace?.branch || "—"}
                </div>
                <FileTree nodes={s.tree} active={s.openFile} onOpen={(p) => void s.openPath(p)} />
              </>
            )}
            {s.sideTab === "approvals" && (
              <div className="stack">
                {s.approvals.map((a) => (
                  <div key={a.approvalId} className="appr-card">
                    <div className="appr-title">
                      {a.title}
                      <span className="risk">{a.risk}</span>
                    </div>
                    <div className="appr-detail">{a.detail}</div>
                    <div className="appr-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void s.resolveApproval(a.approvalId, "approve_once")}
                      >
                        批准一次
                      </button>
                      <button
                        type="button"
                        onClick={() => void s.resolveApproval(a.approvalId, "always_allow")}
                      >
                        始终允许
                      </button>
                      <button
                        type="button"
                        onClick={() => void s.resolveApproval(a.approvalId, "deny")}
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
                <div className="side-section-title">连接器</div>
                {s.connectors.map((c) => (
                  <div key={c.id} className="conn-row">
                    <span>{c.name}</span>
                    <span className={`st ${c.status}`}>{c.status}</span>
                  </div>
                ))}
                {!s.approvals.length && !s.connectors.length && (
                  <div className="empty-hint">无待审批；Host 在线后显示连接器</div>
                )}
              </div>
            )}
            {s.sideTab === "context" && (
              <div className="stack">
                <div className="side-section-title">工作区规则（约定）</div>
                <ul className="rules">
                  <li>组织策略优先；xingzhi.yml 只能收紧</li>
                  <li>人手修改磁盘内容优先于未采纳 Agent patch</li>
                  <li>写入 secrets/ 与 .env 默认拒绝</li>
                  <li>网络默认拒绝，连接器域名可放行</li>
                </ul>
                <div className="side-section-title">已打开</div>
                <div className="mono small">{s.openFile || "—"}</div>
              </div>
            )}
            {s.sideTab === "skills" && (
              <div className="stack">
                {[
                  ["表格分析", "xlsx/csv 聚合与异常"],
                  ["代码执行", "本地 shell / Python"],
                  ["文档生成", "周报与摘要"],
                  ["知识检索", "工作区历史结论"],
                ].map(([n, d]) => (
                  <div key={n} className="skill-card">
                    <strong>{n}</strong>
                    <span>{d}</span>
                  </div>
                ))}
              </div>
            )}
            {s.sideTab === "artifacts" && (
              <div className="stack">
                {s.artifacts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="art-row"
                    onClick={() => void s.openPath(a.path)}
                  >
                    <span className="ext">{a.ext}</span>
                    <span>{a.name}</span>
                  </button>
                ))}
                {!s.artifacts.length && <div className="empty-hint">暂无产物（out/）</div>}
              </div>
            )}
            {s.sideTab === "cost" && (
              <div className="stack">
                <div className="side-section-title">组织策略</div>
                <div className="policy-box">
                  <div>org: {s.policy?.orgId || "—"}</div>
                  <div>maxAuto: {s.policy?.maxAutoExecute || "—"}</div>
                  <div>label: {s.policy?.label || "—"}</div>
                  <div>networkDefaultDeny: {String(s.policy?.networkDefaultDeny ?? true)}</div>
                </div>
                <div className="side-section-title">本地引擎</div>
                {s.providers.map((p) => (
                  <div key={p.id} className="prov-row">
                    <span>
                      {p.displayName}{" "}
                      <span className={p.available ? "ok" : "bad"}>
                        {p.available ? "ready" : "missing"}
                      </span>
                    </span>
                    <span className="mono small">{p.version || p.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      <footer className="status">
        <span>{s.statusLine}</span>
        <span>
          {s.workspace?.rootPath || "no workspace"}
          {s.workspace?.dirtySummary ? ` · ${s.workspace.dirtySummary}` : ""}
        </span>
        <span className="grow" />
        <span>{s.hostOnline ? "local host" : "fixture"}</span>
        {s.error && <span className="err">{s.error}</span>}
      </footer>

      {s.paletteOpen && (
        <div className="palette-mask" onClick={s.togglePalette}>
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <div className="palette-head">命令面板</div>
            <button
              type="button"
              onClick={() => {
                openWorkspace();
                s.togglePalette();
              }}
            >
              打开工作区文件夹…
            </button>
            <button
              type="button"
              onClick={() => {
                void s.newSession();
                s.togglePalette();
              }}
            >
              新建会话
            </button>
            <button
              type="button"
              onClick={() => {
                void s.continueRun();
                s.togglePalette();
              }}
            >
              Continue Run（磁盘优先）
            </button>
            <button
              type="button"
              onClick={() => {
                s.setCenterView("code");
                s.togglePalette();
              }}
            >
              聚焦编辑器
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffView() {
  const s = useWorkbench();
  const edits = s.events.filter(
    (e) => e.type === "file.edit_proposed" || e.type === "file.edit_applied",
  ) as { id: string; path: string; kind: string; additions?: number; deletions?: number }[];
  return (
    <div className="diff-view">
      <div className="diff-head">Agent 提议改动 · 采纳请在磁盘确认后 Continue</div>
      {edits.map((e) => (
        <button key={e.id} type="button" className="diff-row" onClick={() => void s.openPath(e.path)}>
          <span className="kind">{e.kind}</span>
          <span className="mono">{e.path}</span>
          <span className="meta">
            +{e.additions ?? 0} −{e.deletions ?? 0}
          </span>
        </button>
      ))}
      {!edits.length && <div className="empty-hint">暂无 EDITS 事件</div>}
    </div>
  );
}

function ActivityView() {
  const s = useWorkbench();
  return (
    <div className="activity-view">
      {s.runs.map((r) => (
        <div key={r.id} className="act-card">
          <div className="act-top">
            <span className="mono">{r.id}</span>
            <span className={`st ${r.status}`}>{r.status}</span>
          </div>
          <div className="act-title">{r.prompt.slice(0, 80)}</div>
          <div className="act-meta">
            {r.providerId} · {r.planProgress || "—"}
          </div>
        </div>
      ))}
      {!s.runs.length && s.run && (
        <div className="act-card">
          <div className="act-top">
            <span className="mono">{s.run.id}</span>
            <span className={`st ${s.run.status}`}>{s.run.status}</span>
          </div>
          <div className="act-title">{s.run.prompt}</div>
        </div>
      )}
      {!s.runs.length && !s.run && <div className="empty-hint">暂无活动</div>}
    </div>
  );
}
