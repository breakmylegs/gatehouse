import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { defineConfig, type Plugin } from "vite"
import { workspaceAliases } from "../../scripts/workspace-aliases.mjs"

/**
 * C-057: Mermaid's one file, copied into the build as artifact-lib/mermaid.min.js, which the Host inlines into a
 * diagram's sandboxed page. Only that file ships, never Mermaid's own dependencies (it is a development one here).
 */
function mermaidLib(): Plugin {
  return {
    name: "codehouse-mermaid-lib",
    apply: "build",
    closeBundle() {
      const from = createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js")
      const to = path.resolve("dist", "artifact-lib", "mermaid.min.js")
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
    },
  }
}

// The Host serves apps/web/dist. In development the dev server proxies the socket to a running Host.
export default defineConfig({
  // Neighbourhood Watch serves the interface under /app/, so its build loads its scripts and styles from there. The
  // desktop's build keeps "/": the Host serves it at the root, and nothing about it changes (BUILD_REPORT, 17 Nov).
  base: process.env.VITE_CODEHOUSE_REMOTE === "cnw" ? "/app/" : "/",
  plugins: [react(), tailwindcss(), mermaidLib()],
  // The workspace packages from their folders, not through the node_modules links (scripts/workspace-aliases.mjs).
  resolve: { alias: workspaceAliases() },
  // DEMO=1 also builds demo.html (worst-case data for the break-ui pass) and screens.html (the sample views, and the
  // 10,000-message session scripts/perf-check.ts measures in a production build). It is never part of a normal build.
  build: {
    target: "es2023",
    sourcemap: false,
    ...(process.env.DEMO === "1"
      ? {
          rollupOptions: {
            input: { index: "index.html", demo: "demo.html", screens: "screens.html" },
          },
        }
      : {}),
  },
  server: {
    host: "127.0.0.1",
    proxy: { "/ws": { target: "ws://127.0.0.1:47820", ws: true } },
  },
})
