import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * @fontsource ships a legacy `.woff` next to every `.woff2`, which would double
 * the bundled font payload. WebView2 and WKWebView both read woff2, so the
 * fallback is dead weight in a Tauri build.
 */
function woff2Only(): Plugin {
  return {
    name: "herdock:woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@fontsource") || !id.endsWith(".css")) return null;
      return { code: code.replace(/,\s*url\([^)]+\.woff\)\s*format\('woff'\)/g, ""), map: null };
    },
  };
}

export default defineConfig({
  plugins: [woff2Only(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@her-dock/agent-protocol": fileURLToPath(
        new URL("./src/lib/protocol/index.ts", import.meta.url),
      ),
      "@her-dock/shared": fileURLToPath(new URL("./src/lib/shared.ts", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
