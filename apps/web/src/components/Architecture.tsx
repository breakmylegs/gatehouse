import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/**
 * D-042 and D-043: the project's architecture from its imports: drift since you last approved it first (new modules,
 * new edges across a layer boundary, new import cycles), then its C4 diagrams in Mermaid, to copy into documentation
 * (GitHub and most documentation tools draw them).
 */
interface Data {
  problem?: string
  modules: number
  approved: boolean
  drift: { newModules: string[]; newCrossings: string[]; newCycles: string[][] }
  cycles: string[][]
  diagrams: { context: string; container: string; component: string }
}

export function Architecture({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<Data>()
  const [error, setError] = useState<string>()
  const load = () =>
    void send({ type: "architecture", sessionId }).then((r) => (r.ok ? setData(r.data as Data) : setError(r.error?.message ?? "It could not be read")))
  useEffect(load, [sessionId])
  const d = data?.drift
  const drifted = d ? d.newModules.length + d.newCrossings.length + d.newCycles.length : 0
  return (
    <section aria-label="Architecture" className="panel grid gap-3 p-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[17px]">Architecture</h2>
        <span className="text-mut">{data ? `${data.modules} modules, from the project's imports.` : ""}</span>
        <button
          type="button"
          className="btn ml-auto !min-h-7"
          disabled={!data}
          onClick={async () => {
            const r = await send({ type: "architecture_approve", sessionId })
            if (!r.ok) return void toast.error(r.error?.message ?? "It could not be approved")
            toast("Approved as it is now. Drift is measured from here.")
            load()
          }}
        >
          Approve as it is
        </button>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sev">
          {error}
        </p>
      ) : !data ? (
        <p className="m-0 text-mut">Reading the imports…</p>
      ) : (
        <>
          {data.problem ? <p className="m-0 text-warn">{data.problem}.</p> : null}
          {!data.approved ? (
            <p className="m-0 text-mut">Not approved yet: approve it as it is, and later changes show here as drift.</p>
          ) : drifted ? (
            <div role="alert" className="grid gap-1">
              <h3 className="m-0 text-[13.5px] font-semibold text-sev">Drift since you approved it</h3>
              <ul className="m-0 grid list-none gap-1 p-0">
                {d!.newModules.map((m) => (
                  <li key={m}>
                    New module <span className="mono">{m}</span>
                  </li>
                ))}
                {d!.newCrossings.map((e) => (
                  <li key={e}>
                    New edge across a layer boundary: <span className="mono">{e}</span>
                  </li>
                ))}
                {d!.newCycles.map((c) => (
                  <li key={c.join()}>
                    New import cycle: <span className="mono">{c.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="m-0 text-mut">No drift since you approved it.</p>
          )}
          {(["context", "container", "component"] as const).map((k) => (
            <div key={k} className="grid gap-1">
              <div className="flex items-center gap-2">
                <h3 className="m-0 text-[13.5px] font-semibold">C4 {k} diagram (Mermaid)</h3>
                <button
                  type="button"
                  className="btn !min-h-6 !px-2 !text-[12px]"
                  onClick={() => void navigator.clipboard.writeText(data.diagrams[k]).then(() => toast("Copied"))}
                >
                  Copy
                </button>
              </div>
              <pre className="cmd max-h-48 overflow-auto">{data.diagrams[k]}</pre>
            </div>
          ))}
        </>
      )}
    </section>
  )
}
