import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useStore } from "../store"

interface Ask {
  id: string
  sessionId: string
  name: string
  reason: string
  command: string
  at: string
}

const EVERY_MS = 2000

/**
 * T-135: a session asks you for a secret for one command. Only here, on the desktop: never the phone or a push
 * channel. What you type is set for that command alone when it runs, and taken out of everything Codehouse records.
 */
export function SecretRequests() {
  const [asks, setAsks] = useState<Ask[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const titles = useStore((s) => s.sessions)
  useEffect(() => {
    let live = true
    const look = () =>
      void api<{ requests: Ask[] }>("GET", "/api/secret-requests").then((r) => {
        // An answer of another shape (an older Host, say) shows nothing rather than failing.
        if (live && r.ok && Array.isArray(r.data?.requests)) setAsks(r.data.requests)
      })
    look()
    const t = setInterval(look, EVERY_MS)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  async function answer(a: Ask, give: boolean) {
    const r = await api("POST", `/api/secret-requests/${encodeURIComponent(a.id)}`, give ? { value: values[a.id] ?? "" } : { decline: true })
    if (!r.ok) return toast.error(r.error ?? "Not sent", { id: "secret" })
    setValues(({ [a.id]: _gone, ...rest }) => rest)
    setAsks((xs) => xs.filter((x) => x.id !== a.id))
  }
  if (!asks.length) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-50 grid w-[min(560px,92vw)] -translate-x-1/2 gap-2">
      {asks.map((a) => (
        <form
          key={a.id}
          role="dialog"
          aria-label={`A session asks for ${a.name}`}
          className="panel grid gap-2 p-3 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault()
            void answer(a, true)
          }}
        >
          <strong className="text-sm">
            {(titles[a.sessionId] as { title?: string } | undefined)?.title ?? "A session"} asks for {a.name}
          </strong>
          <span className="text-[13px]">{a.reason}</span>
          <span className="text-xs text-mut">For this command only, once:</span>
          <code className="mono whitespace-pre-wrap break-all text-xs">{a.command}</code>
          <input
            className="field mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`The value of ${a.name}`}
            value={values[a.id] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))}
          />
          <span className="text-xs text-mut">
            Claude never sees it. It is set for that command when it runs, after the command is allowed as it stands, and
            is taken out of everything Codehouse records or sends.
          </span>
          <span className="flex justify-end gap-2">
            <button type="button" className="btn !min-h-8" onClick={() => void answer(a, false)}>
              Decline
            </button>
            <button type="submit" className="btn btn-primary !min-h-8" disabled={!values[a.id]}>
              Give it for this command
            </button>
          </span>
        </form>
      ))}
    </div>
  )
}
