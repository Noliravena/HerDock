import { DownloadSimple, FolderOpen } from "@phosphor-icons/react";
import { save } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { hostApi } from "../host/client";
import { useWorkbench } from "../store/workbench";

function formatBytes(n?: number): string {
  if (!n) return "—";
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}

function formatWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function ArtifactsView() {
  const state = useWorkbench(
    useShallow((s) => ({
      artifacts: s.artifacts,
      openPath: s.openPath,
      selectRun: s.selectRun,
      workspace: s.workspace,
    })),
  );

  const exportArtifact = async (path: string, name: string) => {
    if (!state.workspace) return;
    const destination = await save({ defaultPath: name, title: "导出产物" });
    if (destination) await hostApi.exportArtifact(state.workspace.id, path, destination);
  };

  return (
    <div className="console-view">
      <header className="console-head stacked">
        <span className="console-eyebrow">OUT/ · LOCAL ARTIFACTS</span>
        <h1>产物库</h1>
        <span className="console-meta mono">{state.workspace?.rootPath || "未打开工作区"}</span>
      </header>

      <div className="console-scroll">
        <div className="artifact-table">
          <div className="artifact-row head">
            <span>NAME</span>
            <span>RUN</span>
            <span>SIZE</span>
            <span>CREATED</span>
            <span />
          </div>
          {state.artifacts.map((artifact) => (
            <div className="artifact-row" key={artifact.id}>
              <span className="artifact-name">
                <span className={`ext ${artifact.ext}`}>
                  {(artifact.ext || "·").slice(0, 4).toUpperCase()}
                </span>
                <button
                  type="button"
                  className="name"
                  onClick={() => void state.openPath(artifact.path)}
                >
                  <b>{artifact.name}</b>
                  <small className="mono">{artifact.path}</small>
                </button>
              </span>
              <span className="mono artifact-run">
                {artifact.runId ? (
                  <button
                    type="button"
                    className="link"
                    onClick={() => void state.selectRun(artifact.runId!)}
                  >
                    {artifact.runId}
                  </button>
                ) : (
                  "—"
                )}
              </span>
              <span className="mono artifact-size">{formatBytes(artifact.sizeBytes)}</span>
              <span className="mono artifact-time">{formatWhen(artifact.createdAt)}</span>
              <span className="artifact-actions">
                <button
                  type="button"
                  className="icon-btn small"
                  title="在文件夹中定位"
                  onClick={() =>
                    state.workspace &&
                    void hostApi.revealArtifact(state.workspace.id, artifact.path)
                  }
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn small"
                  title="导出副本"
                  onClick={() => void exportArtifact(artifact.path, artifact.name)}
                >
                  <DownloadSimple size={14} />
                </button>
              </span>
            </div>
          ))}
          {!state.artifacts.length && (
            <div className="empty-hint">out/ 目录还是空的，Agent 产出的文件会列在这里。</div>
          )}
        </div>
      </div>
    </div>
  );
}
