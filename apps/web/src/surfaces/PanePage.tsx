import { useEffect } from "react"
import { Toaster } from "sonner"
import { useStore } from "../store"
import { Workspace } from "./Workspace"

/**
 * A session in a window of its own (B16): that one session's pane and nothing else, over the same connection, token
 * and checks as the main window. Closing the window puts it back in the main window.
 */
export function PanePage({ sessionId }: { sessionId: string }) {
  const session = useStore((s) => s.sessions[sessionId])
  useEffect(() => {
    useStore.setState({ panes: [sessionId], selectedSession: sessionId, route: "workspace" })
  }, [sessionId])
  useEffect(() => {
    document.title = session ? `${session.title ?? session.project} - Codehouse` : "Codehouse"
  }, [session])
  return (
    <main className="h-screen min-h-0" aria-label="Session window">
      <Workspace />
      <Toaster position="bottom-right" />
    </main>
  )
}
