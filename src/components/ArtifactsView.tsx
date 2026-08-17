import { useMemo, useState } from "react";
import { DownloadSimple, FolderOpen, MagnifyingGlass } from "@phosphor-icons/react";
import { save } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { hostApi, type Artifact } from "../host/client";
import { useWorkbench } from "../store/workbench";
import { ArtifactCard, ConsoleShell, PageEmpty } from "./pageElements";

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

function isDesignArtifact(artifact: Artifact): boolean {
  return (
    artifact.path.startsWith("out/design/") &&
    ["html", "deck-html"].includes(artifact.renderer || "")
  );
}

export function ArtifactsView() {
  return <GrokArtifacts />;
}

function GrokArtifacts() {
  const state = useWorkbench(
    useShallow((s) => ({
      artifacts: s.artifacts,
      hostOnline: s.hostOnline,
      openDesignArtifact: s.openDesignArtifact,
      openPath: s.openPath,
      selectRun: s.selectRun,
      workspace: s.workspace,
    })),
  );
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return state.artifacts;
    return state.artifacts.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) || item.path.toLowerCase().includes(needle),
    );
  }, [query, state.artifacts]);

  const exportArtifact = async (path: string, name: string) => {
    if (!state.workspace) return;
    const destination = await save({ defaultPath: name, title: "导出产物" });
    if (destination) await hostApi.exportArtifact(state.workspace.id, path, destination);
  };

  const openArtifact = (artifact: Artifact) => {
    if (isDesignArtifact(artifact)) {
      void state.openDesignArtifact(artifact.id);
      return;
    }
    void state.openPath(artifact.path);
  };

  const searching = Boolean(query.trim());

  return (
    <ConsoleShell
      title="产物"
      hostOnline={state.hostOnline}
      actions={
        <label className="g-search">
          <MagnifyingGlass size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文件"
          />
        </label>
      }
    >
      {!visible.length && searching && (
        <PageEmpty title="没有匹配的文件" body="换个文件名或路径再试一次。" />
      )}
      {!visible.length && !searching && (
        <PageEmpty title="还没有产物" body="运行完成后，生成的文件会出现在这里。" />
      )}
      {visible.map((artifact) => {
        const generating = artifact.status === "streaming";
        const meta = [
          (artifact.ext || "file").toUpperCase(),
          formatBytes(artifact.sizeBytes),
          formatWhen(artifact.createdAt),
          artifact.path,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div className="aui-artifact-row" key={artifact.id}>
            <ArtifactCard
              title={artifact.name}
              meta={meta}
              generating={generating}
              onClick={() => openArtifact(artifact)}
            />
            {artifact.runId && (
              <button
                type="button"
                className="g-text-btn"
                onClick={() => void state.selectRun(artifact.runId!)}
              >
                查看运行
              </button>
            )}
            <button
              type="button"
              className="g-icon-btn"
              title="在文件夹中定位"
              onClick={() =>
                state.workspace && void hostApi.revealArtifact(state.workspace.id, artifact.path)
              }
            >
              <FolderOpen size={14} />
            </button>
            <button
              type="button"
              className="g-icon-btn"
              title="导出副本"
              onClick={() => void exportArtifact(artifact.path, artifact.name)}
            >
              <DownloadSimple size={14} />
            </button>
          </div>
        );
      })}
    </ConsoleShell>
  );
}
