import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

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
