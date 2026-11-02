import { defineConfig } from "vite"

export default defineConfig({
  publicDir: false,
  build: {
    target: "es2022",
    emptyOutDir: false,
    lib: { entry: "src/sw.ts", formats: ["iife"], name: "gatehouseSw", fileName: () => "sw.js" },
  },
})
