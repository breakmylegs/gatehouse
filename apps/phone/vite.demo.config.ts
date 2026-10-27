import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

// A build of the phone app with the passkey, storage and network replaced by worst-case demo data, for
// looking at the screens without a Relay or Face ID. Never part of the real build.
const swap: Plugin = {
  name: "demo-swap",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer || !/[\/]src[\/]/.test(importer) || /[\/]demo[\/]/.test(importer)) return null
    if (source === "./core") return path.resolve(import.meta.dirname, "src/demo/core.ts")
    if (source === "./storage") return path.resolve(import.meta.dirname, "src/demo/storage.ts")
    return null
  },
}

export default defineConfig({
  plugins: [swap, react(), tailwindcss()],
  publicDir: "public",
  build: { outDir: "dist-demo", target: "es2022" },
})
