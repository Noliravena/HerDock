import { useEffect, useMemo } from "react";
import { FileText, Image as ImageIcon, WarningCircle } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../store/workbench";
import { hostApi } from "../host/client";

export function FilePreviewPane() {
  const { filePreview, openFile, setCenterView, workspace } = useWorkbench(
    useShallow((state) => ({
      filePreview: state.filePreview,
      openFile: state.openFile,
      setCenterView: state.setCenterView,
      workspace: state.workspace,
    })),
  );
  const blobUrl = useMemo(() => {
    if (!filePreview?.bytesBase64) return null;
    try {
      const binary = atob(filePreview.bytesBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return URL.createObjectURL(new Blob([bytes], { type: filePreview.mime }));
    } catch {
      return null;
    }
  }, [filePreview?.bytesBase64, filePreview?.mime]);
  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  if (!filePreview || !openFile) return null;
  const parts = filePreview.path.split(/[/\\]/);
  return (
    <div className="view">
      <div className="code-bar">
        {parts.map((part, index) => (
          <span key={`${part}-${index}`}>
            {index > 0 && <span className="crumb-sep"> / </span>}
            <span className={index === parts.length - 1 ? "crumb-leaf" : undefined}>{part}</span>
          </span>
        ))}
        <span className="badge">预览</span>
        <div className="segmented">
          <button type="button" className="on">
            预览
          </button>
          <button type="button" onClick={() => setCenterView("diff")}>
            差异
          </button>
        </div>
        {workspace && (
          <button
            type="button"
            className="mini-btn"
            style={{ marginLeft: 8 }}
            onClick={() => void hostApi.revealFile(workspace.id, filePreview.path)}
          >
            在资源管理器中打开
          </button>
        )}
      </div>
      <div className="file-preview-host">
        {filePreview.tooLarge && (
          <div className="file-preview-empty">
            <WarningCircle size={18} />
            文件超过 32MB，未载入预览。可以用系统应用打开。
          </div>
        )}
        {!filePreview.tooLarge && filePreview.kind === "pdf" && blobUrl && (
          <iframe className="file-preview-frame" title={filePreview.path} src={blobUrl} />
        )}
        {!filePreview.tooLarge && filePreview.kind === "image" && blobUrl && (
          <div className="file-preview-image">
            <img src={blobUrl} alt={filePreview.path} />
          </div>
        )}
        {!filePreview.tooLarge && filePreview.text && (
          <pre className="file-preview-text">
            <FileText size={14} />
            {filePreview.text}
          </pre>
        )}
        {!filePreview.tooLarge && filePreview.kind === "image" && !blobUrl && (
          <div className="file-preview-empty">
            <ImageIcon size={18} />
            无法解码这张图片。
          </div>
        )}
      </div>
    </div>
  );
}
