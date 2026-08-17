import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Self-hosted so the design typefaces survive the packaged CSP (font-src 'self')
// and an offline launch. Weights mirror the handoff's font request exactly.
import "@fontsource/schibsted-grotesk/400.css";
import "@fontsource/schibsted-grotesk/500.css";
import "@fontsource/schibsted-grotesk/600.css";
import "@fontsource/schibsted-grotesk/700.css";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./styles.css";
import "./styles/grok-shell.css";
import "./styles/grok-refine.css";
import "./styles/grok-pages.css";
import "./styles/grok-design.css";
import "./styles/grok-theme-light.css";
import "./styles/sidebar.css";
import "./styles/chat.css";

async function bootstrap() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("design-preview")) {
    const { installDesignPreview } = await import("./dev/designPreview");
    installDesignPreview();
  }
  const root = document.getElementById("root");
  if (!root) throw new Error("Root element #root not found");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
