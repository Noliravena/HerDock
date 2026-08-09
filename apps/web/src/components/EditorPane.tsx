import Editor from "@monaco-editor/react";
import { useWorkbench } from "../store/workbench";

export function EditorPane({
  path,
  value,
  onChange,
  readOnly,
}: {
  path: string | null;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
}) {
  const s = useWorkbench();

  if (!path) {
    return (
      <div className="view">
        <div className="editor-empty">
          从右侧文件树打开一个文件。人手改完保存，再点「采纳并继续」，磁盘内容优先。
        </div>
      </div>
    );
  }

  const parts = path.split("/");
  const lang = languageFor(path);

  return (
    <div className="view">
      <div className="code-bar">
        {parts.map((p, i) => (
          <span key={`${p}-${i}`}>
            {i > 0 && <span className="crumb-sep"> / </span>}
            <span className={i === parts.length - 1 ? "crumb-leaf" : undefined}>{p}</span>
          </span>
        ))}
        {s.dirty && <span className="badge">未保存</span>}
        {readOnly && <span className="badge">只读</span>}
        <div className="segmented">
          <button
            type="button"
            className={s.centerView === "code" ? "on" : ""}
            onClick={() => s.setCenterView("code")}
          >
            代码
          </button>
          <button
            type="button"
            className={s.centerView === "diff" ? "on" : ""}
            onClick={() => s.setCenterView("diff")}
          >
            差异
          </button>
        </div>
        <button
          type="button"
          className="mini-btn"
          style={{ marginLeft: 8 }}
          disabled={!s.dirty}
          onClick={() => void s.saveFile()}
        >
          保存
        </button>
      </div>
      <div className="editor-host">
        <Editor
          height="100%"
          language={lang}
          theme="vs"
          value={value}
          onChange={(v) => onChange(v ?? "")}
          options={{
            readOnly: !!readOnly,
            minimap: { enabled: false },
            fontSize: 12.5,
            lineHeight: 21,
            fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            renderLineHighlight: "gutter",
            padding: { top: 10 },
          }}
        />
      </div>
    </div>
  );
}

function languageFor(path: string) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".go")) return "go";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  return "plaintext";
}
