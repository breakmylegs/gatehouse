import { useEffect, useState } from "react"
import { send } from "../store"

interface Link {
  item: string
  kind: "azure-devops" | "jira"
  to: string
  ref: string
  from: string
}

/** E-056: Azure DevOps and Jira ids linked to sessions, commits, evidence packs and stories; kept locally, exported. */
export function WorkItemsPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [links, setLinks] = useState<Link[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void send({ type: "work_items", sessionId, step: "scan" }).then((x) => (x.ok ? setLinks((x.data as { links: Link[] }).links) : setError(x.error?.message ?? "No links")))
  }, [sessionId])
  async function exportAs(format: "csv" | "json") {
    const x = await send({ type: "work_items", sessionId, step: "export", format })
    if (!x.ok) return setError(x.error?.message ?? "Not exported")
    const url = URL.createObjectURL(new Blob([(x.data as { text: string }).text], { type: format === "csv" ? "text/csv" : "application/json" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `work-items.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }
  const byItem = new Map<string, Link[]>()
  for (const l of links ?? []) byItem.set(l.item, [...(byItem.get(l.item) ?? []), l])
  return (
    <section aria-label="Work items" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Work items</h2>
        <span className="flex gap-2">
          <button type="button" className="btn !min-h-7" disabled={!links?.length} onClick={() => void exportAs("csv")}>
            Export CSV
          </button>
          <button type="button" className="btn !min-h-7" disabled={!links?.length} onClick={() => void exportAs("json")}>
            Export JSON
          </button>
          <button type="button" className="btn !min-h-7" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
      {error ? <p className="m-0">{error}</p> : null}
      {links && !links.length ? <p className="m-0 text-mut">No Azure DevOps (AB#1234) or Jira (PROJ-123) ids in this branch, its commits or the requirement ledger.</p> : null}
      <ul className="m-0 grid list-none gap-1 p-0">
        {[...byItem].map(([item, ls]) => (
          <li key={item}>
            <strong className="mono">{item}</strong>{" "}
            <span className="text-mut">
              {ls.map((l) => `${l.to} ${l.to === "commit" || l.to === "evidence" ? l.ref.slice(0, 10) : l.ref}`).join(", ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-xs text-mut">Kept on this computer only; nothing is sent to Azure DevOps or Jira.</p>
    </section>
  )
}
