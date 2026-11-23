import { useEffect, useRef, useState } from "react"
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

/** A release date as the timeline shows it: 6 Nov 2026. */
export function releaseDate(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "date not known"
}

/** Compares two versions (2.0.97 and 2.0.100): below zero when a is older. Words after a dash count for less. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split("-")[0]!.split(".").map((n) => Number(n) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** Where the window keeps when you last opened the changelog, for what is new since. */
export const SEEN_KEY = "codeh:changelog-seen"
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? undefined
  } catch {
    return undefined
  }
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
 * O44 (owner, 20 Nov): the changelog as a timeline, like a session's timeline but of Codehouse's own releases. Each
 * release is a point with its version and date, oldest on the left and scrolled to the newest; the version you run,
 * newer ones not installed yet, and those new since you last opened it are marked. Pressing a point, or moving to it
 * with the arrow keys, shows what was new in that release, drawn as text, never as HTML. Read from GitHub like an
 * update; the last copy read is shown when GitHub cannot be reached.
 */
export function ChangelogPanel({ current }: { current?: string }) {
  const [view, setView] = useState<View>()
  const [picked, setPicked] = useState<string>()
  const [busy, setBusy] = useState(false)
  // What was new since you last opened it: kept from before this opening, then this opening is noted.
  const [seenBefore] = useState(readSeen)
  const strip = useRef<HTMLOListElement>(null)
  const load = async (fresh: boolean) => {
    setBusy(true)
    const r = await api<View>("GET", `/api/changelog${fresh ? "?fresh=1" : ""}`)
    setBusy(false)
    if (r.ok && r.data) setView(r.data)
    else setView({ releases: [], offline: true })
  }
  useEffect(() => void load(false), [])
  useEffect(() => {
    try {
      localStorage.setItem(SEEN_KEY, new Date().toISOString())
    } catch {
      /* private mode */
    }
  }, [])
  const ordered = [...(view?.releases ?? [])].sort((a, b) => compareVersions(a.version, b.version))
  useEffect(() => {
    const el = strip.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [ordered.length])
  if (!view) return <p className="m-0 text-mut">Reading the changelog…</p>
  const shown = ordered.find((r) => r.version === picked) ?? ordered.find((r) => r.version === current) ?? ordered.at(-1)
  const at = shown ? ordered.indexOf(shown) : -1
  const marks = (r: Entry) =>
    [
      r.version === current ? "this version" : current && compareVersions(r.version, current) > 0 ? "not installed yet" : "",
      seenBefore && Date.parse(r.date) > Date.parse(seenBefore) ? "new since you last looked" : "",
    ].filter(Boolean)
  const move = (to: number) => {
    const r = ordered[Math.max(0, Math.min(ordered.length - 1, to))]
    if (!r) return
    setPicked(r.version)
    strip.current?.querySelector<HTMLButtonElement>(`[data-version="${CSS.escape(r.version)}"]`)?.focus()
  }
  return (
    <div className="grid gap-3">
      {view.offline ? (
        <p role="status" className="m-0 text-[13px] text-mut">
          {view.releases.length
            ? `GitHub could not be reached, so this is the changelog as last read${view.readAt ? ` on ${releaseDate(view.readAt)}` : ""}.`
            : "GitHub could not be reached, and the changelog has not been read before. Try again when you are online."}
        </p>
      ) : null}
      {ordered.length ? (
        <ol
          ref={strip}
          className="summary-timeline m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1"
          aria-label="Releases, oldest first"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
              e.preventDefault()
              move(e.key === "Home" ? 0 : e.key === "End" ? ordered.length - 1 : at + (e.key === "ArrowLeft" ? -1 : 1))
            }
          }}
        >
          {ordered.map((r) => {
            const m = marks(r)
            return (
              <li key={r.version} className="shrink-0">
                <button
                  type="button"
                  className="summary-node"
                  data-version={r.version}
                  aria-pressed={r === shown}
                  tabIndex={r === shown ? 0 : -1}
                  aria-label={`Version ${r.version}, released ${releaseDate(r.date)}${m.length ? `, ${m.join(", ")}` : ""}`}
                  onClick={() => setPicked(r.version)}
                >
                  <span className="summary-dot" aria-hidden="true" data-mark={m.includes("this version") ? "current" : m.includes("not installed yet") ? "newer" : undefined} />
                  <span className="text-[13px] font-semibold">{r.version}</span>
                  <span className="text-[12px] text-mut">{releaseDate(r.date)}</span>
                  {m.length ? <span className="text-[11px] font-semibold">{m.map((x) => (x === "this version" ? "This version" : x === "not installed yet" ? "Not installed" : "New")).join(" · ")}</span> : null}
                </button>
              </li>
            )
          })}
        </ol>
      ) : null}
      {shown ? (
        <section aria-label={`What was new in ${shown.version}`} aria-live="polite" className="grid gap-1">
          <h3 className="m-0 text-[14px]">
            {shown.version}, released {releaseDate(shown.date)}
          </h3>
          <Notes text={shown.notes} />
        </section>
      ) : null}
      <div>
        <button type="button" className="btn !min-h-7" disabled={busy} onClick={() => void load(true)}>
          {busy ? "Reading…" : "Read it again"}
        </button>
      </div>
    </div>
  )
}
