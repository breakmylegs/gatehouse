import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useSessionList } from "../store"

/**
 * D-077: the parts of a project's instructions (CLAUDE.md, AGENTS.md) a session never used, with their size, and how
 * many of the project's recent sessions used each, so you can see what fills every session's context for nothing.
 */
interface BlockUse {
  file: string
  heading: string
  line: number
  tokens: number
  terms: string[]
  used?: boolean
  sessionsUsing: number
  sessions: number
}
interface Report {
  root: string
  blocks: BlockUse[]
  unusedTokens: number
  totalTokens: number
}

export function ContextEfficiency() {
  const sessions = useSessionList().filter((s) => s.state !== "ended")
  const [chosen, setChosen] = useState<string>()
  const id = chosen ?? sessions[0]?.id
  const [r, setR] = useState<Report>()
  const [busy, setBusy] = useState(false)
  useEffect(() => setR(undefined), [id])
  if (!sessions.length) return null
  const look = async () => {
    if (!id) return
    setBusy(true)
    const got = await api<Report>("GET", `/api/insights/context?session=${encodeURIComponent(id)}`)
    setBusy(false)
    if (got.ok && got.data) setR(got.data)
    else toast.error(got.error ?? "The report could not be made.", { id: "ctx" })
  }
  const unused = r?.blocks.filter((b) => b.used === false) ?? []
  const unchecked = r?.blocks.filter((b) => b.used === undefined) ?? []
  return (
    <section aria-label="Instructions not used" className="grid gap-2">
      <h2 className="m-0 text-[18px]">Instructions a session did not use</h2>
      <p className="m-0 max-w-[720px] text-[13px] text-mut">
        Each part of the project's CLAUDE.md and AGENTS.md is in every session's context. A part counts as used when a tool call named a command, path or name it gives.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-[13px] text-mut">Session</span>
          <select className="field" value={id} onChange={(e) => setChosen(e.target.value)}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.project}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>
          {busy ? "Reading..." : "Check the instructions"}
        </button>
      </div>
      {r ? (
        <>
          <p className="m-0" role="status">
            {r.blocks.length
              ? `${unused.length} of ${r.blocks.length} parts were not used in this session, about ${r.unusedTokens.toLocaleString("en-GB")} of ${r.totalTokens.toLocaleString("en-GB")} tokens.`
              : `${r.root} has no CLAUDE.md or AGENTS.md at its root.`}
          </p>
          {unused.length ? (
            <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
              {unused.map((b) => (
                <li key={`${b.file}:${b.line}`}>
                  <span className="font-semibold">{b.heading}</span> (<span className="mono">{b.file}</span> line {b.line}, about {b.tokens} tokens)
                  {b.sessions ? `: used in ${b.sessionsUsing} of the ${b.sessions} other recent sessions here` : ""}.
                </li>
              ))}
            </ul>
          ) : null}
          {unchecked.length ? (
            <p className="m-0 text-[13px] text-mut">
              {unchecked.length} part{unchecked.length === 1 ? " names" : "s name"} no command, path or name to check: {unchecked.map((b) => b.heading).join(", ")}.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
