import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { workspaceAliases } from "../../scripts/workspace-aliases.mjs"

// The service worker is built separately (vite.sw.config.ts) as one classic script, which every iPhone accepts.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The workspace packages from their folders, not through the node_modules links (scripts/workspace-aliases.mjs).
  resolve: { alias: workspaceAliases() },
  build: { target: "es2022", sourcemap: false },
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8080" } },
})
