import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Data {
  grants: Array<{ id: string; tool: string; covers: string; project?: string; folder?: string; maxUses?: number; expiresAt?: string; grantedBy: string; why: string }>
  exceptions: Array<{ at: string; kind: string; project?: string; who: string; why: string }>
  reminders: Array<{ id: string; text: string }>
  csv: string
}

/** E-078: every grant and exception, who made it, why, its scope and expiry; reminders before a grant ends. */
export function ExceptionsPanel({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<Data>()
  useEffect(() => {
    void send({ type: "exceptions_register" }).then((x) => (x.ok ? setD(x.data as Data) : toast.error(x.error?.message ?? "Not read", { id: "exceptions" })))
  }, [])
  function save() {
    if (!d) return
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([d.csv], { type: "text/csv" }))
    a.download = `policy-exceptions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <section aria-label="Policy exceptions" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Policy exceptions</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {d?.reminders.length ? (
        <ul className="m-0 grid gap-0.5 pl-5 font-semibold" role="status">
          {d.reminders.map((r) => (
            <li key={r.id}>{r.text}</li>
          ))}
        </ul>
      ) : null}
      {d ? (
        <>
          <strong>Grants ({d.grants.length})</strong>
          {d.grants.length ? (
            <ul className="m-0 grid list-none gap-1 p-0">
              {d.grants.map((g) => (
                <li key={g.id}>
                  <span className="mono">
                    {g.tool} {g.covers}
                  </span>
                  <span className="text-mut">
                    {" "}
                    {g.project ? `in ${g.project}, ` : ""}
                    {g.folder ? `under ${g.folder}, ` : ""}
                    {g.maxUses ? `${g.maxUses} uses, ` : ""}
                    {g.expiresAt ? `ends ${g.expiresAt.slice(0, 10)}` : "no end date"}; granted by {g.grantedBy}; why: {g.why}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-mut">No grant.</p>
          )}
          <strong>Other exceptions in the last year ({d.exceptions.length})</strong>
          {d.exceptions.slice(0, 50).map((e) => (
            <span key={`${e.at}${e.kind}`}>
              {e.at.slice(0, 10)}: {e.kind}
              {e.project ? ` in ${e.project}` : ""}, by {e.who}: {e.why}
            </span>
          ))}
          <button type="button" className="btn !min-h-7 justify-self-start" onClick={save}>
            Export as CSV
          </button>
        </>
      ) : null}
    </section>
  )
}
