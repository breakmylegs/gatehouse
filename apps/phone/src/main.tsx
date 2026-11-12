import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles.css"
import "./glass.css" // Mac fork: Liquid Glass

if ("serviceWorker" in navigator) {
  addEventListener(
    "load",
    () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined),
  )
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
