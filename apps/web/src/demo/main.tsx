import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "../App"
import "../styles.css"
import { useStore } from "../store"
import { type Case, health, pending, sessions } from "./data"

function load(c: Case) {
  const n = c === "worst" ? 300 : c === "normal" ? 3 : 0
  const s = c === "worst" ? 40 : c === "normal" ? 3 : 0
  useStore.setState({
    conn: c === "offline" ? "closed" : "open",
    hasToken: true,
    sessions: {},
    pending: {},
    resolved: {},
    transcripts: {},
    route: "approvals",
  })
  const h = useStore.getState().handleEvent
  h({ type: "hello", sessions: sessions(s), pending: pending(n, s), health: health(c), usage: {} })
  if (c === "worst") {
    for (let i = 0; i < 400; i++)
      h({
        type: "sdk_message",
        sessionId: "s0",
        message: {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text:
                  `Message ${i}\n\n` +
                  "word ".repeat(i % 50) +
                  "\n\n```\nconst x = " +
                  "1".repeat(200) +
                  "\n```\n",
              },
            ],
          },
        },
      })
    useStore.setState({ selectedSession: "s0" })
  }
}

const params = new URLSearchParams(location.search)
const initial = (params.get("case") ?? "worst") as Case
load(initial)

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <div className="grid h-full grid-rows-[auto_1fr]">
      <label className="flex items-center gap-2 border-b border-line bg-s2 px-4 py-1.5">
        <span>Demo data</span>
        <select
          className="field"
          defaultValue={initial}
          onChange={(e) => load(e.target.value as Case)}
        >
          {(["normal", "worst", "empty", "offline", "approver-down", "killed"] as Case[]).map(
            (c) => (
              <option key={c}>{c}</option>
            ),
          )}
        </select>
        <span className="text-xs text-mut">Worst case data, not connected to a Host.</span>
      </label>
      <div className="min-h-0">
        <App />
      </div>
    </div>
  </StrictMode>,
)
