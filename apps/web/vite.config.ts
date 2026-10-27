import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The Host serves apps/web/dist. In development the dev server proxies the socket to a running Host.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { target: "es2023", sourcemap: false },
  server: {
    host: "127.0.0.1",
    proxy: { "/ws": { target: "ws://127.0.0.1:47820", ws: true } },
  },
})
