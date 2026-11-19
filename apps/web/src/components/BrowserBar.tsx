import { useEffect, useState } from "react"
import { api } from "../lib/api"

/**
 * T-113: above a local page, its tabs (pages on this computer you opened beside the session, kept while the panel is
 * open) and the ports the session's own processes listen on, each a page to open. Only addresses on this computer.
 */
export interface Port {
  port: number
  pid: number
  process: string
  address: string
}

/** Tabs after opening `url`: one already open is chosen, not added; at most eight. */
export function withTab(tabs: string[], url: string): string[] {
  return tabs.includes(url) ? tabs : [...tabs, url].slice(-8)
}

export const portUrl = (p: Pick<Port, "port">) => `http://localhost:${p.port}/`

export function BrowserBar({ sessionId, url, onOpen }: { sessionId: string; url: string; onOpen: (url: string) => void }) {
  const [tabs, setTabs] = useState<string[]>([url])
  const [ports, setPorts] = useState<Port[]>()
  useEffect(() => setTabs((t) => withTab(t, url)), [url])
  const look = () =>
    void api<{ ports: Port[] }>("GET", `/api/session/ports?session=${encodeURIComponent(sessionId)}`).then((r) => setPorts(r.ok && r.data ? r.data.ports : []))
  useEffect(look, [sessionId])
  return (
    <div className="grid gap-1 border-b border-line px-2 py-1 text-[13px]">
      <div role="tablist" aria-label="Local pages" className="flex flex-wrap items-center gap-1">
        {tabs.map((t) => (
          <span key={t} className="inline-flex items-center">
            <button type="button" role="tab" aria-selected={t === url} className={t === url ? "btn !min-h-7 font-semibold" : "btn !min-h-7"} onClick={() => onOpen(t)}>
              {t.replace(/^http:\/\//, "").replace(/\/$/, "")}
            </button>
            {tabs.length > 1 ? (
              <button
                type="button"
                className="btn !min-h-7 !px-1"
                aria-label={`Close ${t}`}
                onClick={() => {
                  const rest = tabs.filter((x) => x !== t)
                  setTabs(rest)
                  if (t === url && rest[0]) onOpen(rest[0])
                }}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-mut">
        <span>Listening in this session:</span>
        {ports === undefined ? (
          <span>looking...</span>
        ) : ports.length ? (
          ports.map((p) => (
            <button key={p.port} type="button" className="btn !min-h-7" title={`${p.process} (process ${p.pid}) on ${p.address}`} onClick={() => onOpen(portUrl(p))}>
              {p.port} {p.process.replace(/\.exe$/i, "")}
            </button>
          ))
        ) : (
          <span>nothing yet</span>
        )}
        <button type="button" className="btn !min-h-7" onClick={look}>
          Look again
        </button>
      </div>
    </div>
  )
}
