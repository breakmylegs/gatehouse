import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles.css"
import { startConnection, useStore } from "./store"

const root = createRoot(document.getElementById("root") as HTMLElement)
if (startConnection()) {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} else {
  useStore.setState({ hasToken: false })
  root.render(
    <main className="mx-auto mt-24 max-w-xl p-6">
      <h1 className="text-[22px] font-semibold">Open Gatehouse from the address it printed</h1>
      <p>
        This page needs the one-time address that the Host prints when it starts. It ends in
        <code className="mono"> #token=</code> followed by a long code. Start Gatehouse again and
        open that address.
      </p>
    </main>,
  )
}
