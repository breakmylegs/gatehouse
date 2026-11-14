import { useEffect, useRef, useState } from "react"
import { APPEARANCE_EVENT, readAppearance } from "../lib/appearance"
import { titleStatus, withStatus } from "../lib/titleStatus"
import { useStore } from "../store"

/**
 * One place that tells a screen reader what arrived (W1-12): a new request waiting on you, and what happened lately
 * (a turn that finished or failed, Claude telling you something). Each is said once, politely, so it never
 * interrupts what you are reading or typing. Settings, Appearance chooses how much is said (T-057), and can put
 * "Needs you" or "Working" at the start of the window title, never naming a command, a file or a project.
 */
export function Announcer() {
  const pending = useStore((s) => s.pending)
  const notices = useStore((s) => s.notices)
  const sessions = useStore((s) => s.sessions)
  const [said, setSaid] = useState("")
  const [changed, setChanged] = useState(0)
  useEffect(() => {
    const on = () => setChanged((n) => n + 1)
    window.addEventListener(APPEARANCE_EVENT, on)
    return () => window.removeEventListener(APPEARANCE_EVENT, on)
  }, [])
  const seenRequests = useRef<Set<string> | undefined>(undefined)
  const lastNotice = useRef<string | undefined>(undefined)
  useEffect(() => {
    const ids = Object.keys(pending)
    // What was already there when the window opened is not news.
    if (!seenRequests.current) {
      seenRequests.current = new Set(ids)
      return
    }
    const fresh = ids.filter((id) => !seenRequests.current!.has(id))
    for (const id of ids) seenRequests.current.add(id)
    const v = fresh.map((id) => pending[id]).at(-1)
    if (!v || readAppearance().announce === "off") return
    const what =
      v.request.toolName === "Bash" || v.request.toolName === "PowerShell"
        ? "Run shell command"
        : v.request.toolName
    setSaid(
      fresh.length > 1
        ? `${fresh.length} new requests are waiting on you.`
        : `New request waiting on you: ${what}, in ${v.request.project}.`,
    )
  }, [pending])
  useEffect(() => {
    const top = notices[0]
    if (lastNotice.current === undefined) {
      lastNotice.current = top?.id ?? ""
      return
    }
    if (!top || top.id === lastNotice.current) return
    lastNotice.current = top.id
    if (readAppearance().announce === "all") setSaid(top.text)
  }, [notices])
  useEffect(() => {
    const status = readAppearance().titleStatus
      ? titleStatus(Object.values(sessions), Object.keys(pending).length)
      : undefined
    const next = withStatus(document.title, status)
    if (next !== document.title) document.title = next
  }, [sessions, pending, changed])
  return (
    <div role="status" aria-live="polite" className="sr-only" data-announcer>
      {said}
    </div>
  )
}
