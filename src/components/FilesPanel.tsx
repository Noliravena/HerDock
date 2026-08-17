import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../store/workbench";
import { X } from "@phosphor-icons/react";
import { PanelSash } from "./PanelSash";
import { GrokWorkspaceFiles } from "./GrokWorkspaceFiles";

/** Right-hand workspace files rail. Only mounted in the session (chat) view;
    the toggle lives on the tab bar. */
export function FilesPanel() {
  const { filesWidth, resetFilesWidth, setFilesWidth, toggleFiles, workspace } = useWorkbench(
    useShallow((state) => ({
      filesWidth: state.filesWidth,
      resetFilesWidth: state.resetFilesWidth,
      setFilesWidth: state.setFilesWidth,
      toggleFiles: state.toggleFiles,
      workspace: state.workspace,
    })),
  );
  if (!workspace) return null;
  return (
    <aside className="files-panel" aria-label="工作区文件">
      <PanelSash
        label="调节文件面板宽度"
        invert
        value={filesWidth}
        onChange={setFilesWidth}
        onReset={resetFilesWidth}
      />
      <header className="files-panel-head">
        <span>文件</span>
        <button
          type="button"
          className="files-panel-close"
          title="收起文件面板"
          aria-label="收起文件面板"
          onClick={toggleFiles}
        >
          <X size={13} />
        </button>
      </header>
      <div className="files-panel-body">
        <GrokWorkspaceFiles />
      </div>
    </aside>
  );
}
