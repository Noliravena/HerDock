import { useState } from "react";
import {
  FilePlus,
  FolderPlus,
  MagnifyingGlass,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { hostApi, type SearchResult } from "../host/client";
import { useWorkbench } from "../store/workbench";
import { FileTree } from "./FileTree";
import { useConfirm } from "./pageElements";

/** Workspace file browser that lives in the Grok sidebar — ported from the
    classic workbench's right-panel workspace tab (search / create / rename / delete). */
export function GrokWorkspaceFiles() {
  const { openFile, openPath, refreshTree, tree, workspace } = useWorkbench(
    useShallow((state) => ({
      openFile: state.openFile,
      openPath: state.openPath,
      refreshTree: state.refreshTree,
      tree: state.tree,
      workspace: state.workspace,
    })),
  );
  const [mode, setMode] = useState<"search" | "file" | "dir" | "rename" | null>(null);
  const [value, setValue] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [askConfirm, confirmLayer] = useConfirm();
  const deletePath = (path: string) => {
    if (!workspace) return;
    void askConfirm({
      title: "删除文件？",
      body: `确认删除 ${path}？此操作无法撤销。`,
      confirmLabel: "删除",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void hostApi
        .deleteFile(workspace.id, path)
        .then(() => {
          if (openFile === path) {
            useWorkbench.setState({
              openFile: null,
              fileContent: "",
              centerView: "chat",
              activeTab: "chat",
            });
          }
          return refreshTree();
        })
        .catch((error) => useWorkbench.setState({ error: String(error) }));
    });
  };
  const submit = async () => {
    if (!workspace || !value.trim() || !mode) return;
    try {
      if (mode === "search") {
        setResults(await hostApi.searchFiles(workspace.id, value));
        return;
      }
      if (mode === "rename" && openFile) await hostApi.renameFile(workspace.id, openFile, value);
      else await hostApi.createFile(workspace.id, value, mode === "dir" ? "dir" : "file");
      setMode(null);
      setValue("");
      await refreshTree();
      if (mode === "rename") await openPath(value);
    } catch (error) {
      useWorkbench.setState({ error: String(error) });
    }
  };
  const chooseMode = (next: typeof mode) => {
    setMode(next);
    setValue(next === "rename" ? openFile || "" : "");
    setResults([]);
  };

  return (
    <div className="g-files">
      <div className="g-files-tools">
        <button type="button" title="搜索文件" onClick={() => chooseMode("search")}>
          <MagnifyingGlass size={13} />
        </button>
        <button type="button" title="新建文件" onClick={() => chooseMode("file")}>
          <FilePlus size={13} />
        </button>
        <button type="button" title="新建文件夹" onClick={() => chooseMode("dir")}>
          <FolderPlus size={13} />
        </button>
        <span />
        <button
          type="button"
          title="重命名当前文件"
          disabled={!openFile}
          onClick={() => chooseMode("rename")}
        >
          <PencilSimple size={13} />
        </button>
        <button
          type="button"
          title="删除当前文件"
          disabled={!openFile}
          onClick={() => {
            if (!openFile) return;
            deletePath(openFile);
          }}
        >
          <Trash size={13} />
        </button>
      </div>
      {mode && (
        <div className="g-files-input">
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void submit()}
            placeholder={
              mode === "search"
                ? "搜索文件或内容"
                : mode === "rename"
                  ? "新的相对路径"
                  : mode === "dir"
                    ? "文件夹相对路径"
                    : "文件相对路径"
            }
          />
          <button type="button" onClick={() => void submit()}>
            {mode === "search" ? "搜索" : "确认"}
          </button>
        </div>
      )}
      {results.length > 0 && (
        <div className="g-files-results">
          {results.map((result) => (
            <button
              type="button"
              key={`${result.path}:${result.line}`}
              onClick={() => void openPath(result.path)}
            >
              <span>
                {result.path}
                {result.line ? `:${result.line}` : ""}
              </span>
              <small>{result.preview}</small>
            </button>
          ))}
        </div>
      )}
      {tree.length ? (
        <FileTree
          nodes={tree}
          active={openFile}
          onOpen={(p) => void openPath(p)}
          onReveal={(path) => workspace && void hostApi.revealFile(workspace.id, path)}
          onCopyPath={(path) => void navigator.clipboard.writeText(path)}
          onCreate={(prefix, kind) => {
            setMode(kind === "dir" ? "dir" : "file");
            setValue(prefix);
          }}
          onRename={(path) => {
            setMode("rename");
            setValue(path);
            setResults([]);
            void openPath(path);
          }}
          onDelete={(path) => deletePath(path)}
        />
      ) : (
        <p className="g-empty">工作区为空，或尚未打开本地文件夹。</p>
      )}
      {confirmLayer}
    </div>
  );
}
