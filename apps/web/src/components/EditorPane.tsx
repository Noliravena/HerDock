import Editor from "@monaco-editor/react";

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
  if (!path) {
    return <div className="editor-empty">从右侧文件树打开文件，可人手修改后 Continue Run</div>;
  }
  const lang = languageFor(path);
  return (
    <div className="editor-wrap">
      <div className="editor-bar">
        <span className="mono">{path}</span>
        {readOnly && <span className="badge">只读</span>}
      </div>
      <Editor
        height="100%"
        language={lang}
        theme="vs"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={{
          readOnly: !!readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
        }}
      />
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
