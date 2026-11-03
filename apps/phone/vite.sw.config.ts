import { defineConfig } from "vite"
import { workspaceAliases } from "../../scripts/workspace-aliases.mjs"

export default defineConfig({
  publicDir: false,
  resolve: { alias: workspaceAliases() },
  build: {
    target: "es2022",
    emptyOutDir: false,
    lib: { entry: "src/sw.ts", formats: ["iife"], name: "gatehouseSw", fileName: () => "sw.js" },
  },
})
