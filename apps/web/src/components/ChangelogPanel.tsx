import { useEffect, useState } from "react"
import { api } from "../lib/api"

interface Entry {
  version: string
  date: string
  notes: string
}
interface View {
  releases: Entry[]
  readAt?: string
  offline?: boolean
}

/** A release date as the drop-down shows it: 6 Nov 2026. */
export function releaseDate(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "date not known"
}

/** A release's notes as plain text in a few shapes (headings, list items, lines); never as HTML. */
function Notes({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return <p className="m-0 text-mut">No notes for this release.</p>
  return (
    <div className="grid gap-1 text-[14px] leading-relaxed">
      {lines.map((l, i) => {
        const heading = /^#{1,6}\s+(.*)$/.exec(l)
        if (heading)
          return (
            <h4 key={i} className="m-0 mt-2 text-[14px]">
              {heading[1]}
            </h4>
          )
        const item = /^\s*[-*]\s+(.*)$/.exec(l)
        if (item)
          return (
            <p key={i} className="m-0 pl-4 -indent-3 [overflow-wrap:anywhere]">
              • {item[1]!.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")}
            </p>
          )
        return (
          <p key={i} className="m-0 [overflow-wrap:anywhere]">
            {l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")}
          </p>
        )
      })}
    </div>
  )
}

/**
 * The changelog (owner, 4 Nov): pick a release from the drop-down, by version and release date, and read what was new
 * in it. Read from GitHub like an update, and the last copy read is shown when GitHub cannot be reached.
 */
export function ChangelogPanel({ current }: { current?: string }) {
  const [view, setView] = useState<View>()
  const [picked, setPicked] = useState<string>()
  const [busy, setBusy] = useState(false)
  const load = async (fresh: boolean) => {
    setBusy(true)
    const r = await api<View>("GET", `/api/changelog${fresh ? "?fresh=1" : ""}`)
    setBusy(false)
    if (r.ok && r.data) setView(r.data)
    else setView({ releases: [], offline: true })
  }
  useEffect(() => void load(false), [])
  if (!view) return <p className="m-0 text-mut">Reading the changelog…</p>
  const shown =
    view.releases.find((r) => r.version === picked) ??
    view.releases.find((r) => r.version === current) ??
    view.releases[0]
  return (
    <div className="grid gap-3">
      {view.offline ? (
        <p role="status" className="m-0 text-[13px] text-mut">
          {view.releases.length
            ? `GitHub could not be reached, so this is the changelog as last read${view.readAt ? ` on ${releaseDate(view.readAt)}` : ""}.`
            : "GitHub could not be reached, and the changelog has not been read before. Try again when you are online."}
        </p>
      ) : null}
      {view.releases.length ? (
        <label className="grid gap-1">
          <span className="text-[13px] font-semibold">Version</span>
          <select
            className="field"
            value={shown?.version}
            onChange={(e) => setPicked(e.target.value)}
          >
            {view.releases.map((r) => (
              <option key={r.version} value={r.version}>
                {r.version}, released {releaseDate(r.date)}
                {r.version === current ? " (this one)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {shown ? (
        <section aria-label={`What was new in ${shown.version}`}>
          <Notes text={shown.notes} />
        </section>
      ) : null}
      <div>
        <button
          type="button"
          className="btn !min-h-7"
          disabled={busy}
          onClick={() => void load(true)}
        >
          {busy ? "Reading…" : "Read it again"}
        </button>
      </div>
    </div>
  )
}
