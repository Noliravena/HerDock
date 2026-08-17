import { Check, Copy } from "@phosphor-icons/react";
import { isValidElement, memo, useState, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/** Walk a highlighted code element tree back into copyable plain text. */
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

function CodeBlock({ lang, text, children }: { lang: string; text: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code" data-lang={lang || "text"}>
      <div className="md-code-head">
        <span className="md-code-lang">{lang || "text"}</span>
        <button
          type="button"
          className="md-code-copy"
          aria-label="复制代码"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              })
              .catch(() => undefined);
          }}
        >
          {copied ? <Check size={11} weight="bold" /> : <Copy size={11} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="md-code-body">{children}</pre>
    </div>
  );
}

const markdownComponents: Components = {
  pre({ children }) {
    const child = (Array.isArray(children) ? children[0] : children) as
      ReactElement<{ className?: string; children?: ReactNode }> | undefined;
    const className = child?.props.className || "";
    const lang = /language-([\w+-]+)/.exec(className)?.[1] || "";
    return (
      <CodeBlock lang={lang} text={nodeText(child?.props.children)}>
        {children}
      </CodeBlock>
    );
  },
  code({ className, children, ...rest }) {
    if (className?.includes("language-")) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="md-inline-code" {...rest}>
        {children}
      </code>
    );
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

/** Assistant prose rendered as markdown: GFM tables, task lists, highlighted code blocks. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
