import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { ErrorBoundary } from "./components/ErrorBoundary"
import "./styles.css"
import { startConnection, useStore } from "./store"

const root = createRoot(document.getElementById("root") as HTMLElement)
if (startConnection()) {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
} else {
  useStore.setState({ hasToken: false })
  root.render(
    <main className="mx-auto mt-24 max-w-xl p-6">
      <h1 className="text-[22px] font-semibold">
        Open Jean-Claude Van Code from the address it printed
      </h1>
      <p>
        This page needs the one-time address that the Host prints when it starts. It ends in
        <code className="mono"> #token=</code> followed by a long code. Start the app again and open
        that address.
      </p>
    </main>,
  )
}

// The start-up picture is in index.html so it is on screen before any script runs, in every theme and
// whether or not Jean-Claude mode is on. Keep it up for a moment, then fade it out.
const boot = document.getElementById("boot")
if (boot) {
  setTimeout(() => {
    boot.dataset.leaving = "1"
    setTimeout(() => boot.remove(), 500)
  }, 1800)
}
