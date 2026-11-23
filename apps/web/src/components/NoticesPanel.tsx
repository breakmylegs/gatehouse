import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Result {
  packages: number
  missing: string[]
  none?: string
  text: string
  written?: string
}

/** E-070: the project's third-party notices, from its dependencies' licences and notice files. */
export function NoticesPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [r, setR] = useState<Result>()
  const [busy, setBusy] = useState(false)
  async function run(write: boolean) {
    setBusy(true)
    const x = await send({ type: "third_party_notices", sessionId, ...(write ? { write: true } : {}) })
    setBusy(false)
    if (!x.ok) return void toast.error(x.error?.message ?? "Not generated", { id: "notices" })
    const d = x.data as Result
    setR(d)
    if (d.written) toast(`Written to ${d.written}`, { id: "notices" })
  }
  return (
    <section aria-label="Third-party notices" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Third-party notices</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary !min-h-7" disabled={busy} onClick={() => void run(false)}>
          {busy ? "Working…" : "Generate"}
        </button>
        <button type="button" className="btn !min-h-7" disabled={busy || !r || !!r.none} onClick={() => void run(true)}>
          Write THIRD-PARTY-NOTICES.txt
        </button>
      </div>
      {r?.none ? <p className="m-0">{r.none}</p> : null}
      {r && !r.none ? (
        <>
          <p className="m-0">
            {r.packages} package(s).{" "}
            {r.missing.length ? <span className="font-semibold">{r.missing.length} with something missing:</span> : "Nothing is missing."}
          </p>
          {r.missing.length ? (
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {r.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => void navigator.clipboard.writeText(r.text).then(() => toast("Copied", { id: "notices" }))}>
            Copy the notices
          </button>
        </>
      ) : null}
    </section>
  )
}
