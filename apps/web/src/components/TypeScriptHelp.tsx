import { useEffect, useState } from "react"
import { api } from "../lib/api"

/**
 * C-032: TypeScript's own language service under a .ts, .tsx, .js or .jsx file in the file view: the file's problems,
 * what the name at the cursor is (as text here, never a hover tooltip), and Go to definition (F12) and Find references,
 * each a list of places to go to. A place in another file opens it there.
 */
export const TS_FILE = /\.(m|c)?(t|j)sx?$/i

export interface Place {
  file: string
  line: number
  column: number
  text: string
}
interface Problem extends Place {
  message: string
  severity: "error" | "warning" | "info"
}

export function TypeScriptHelp({
  sessionId,
  rel,
  pos,
  ask,
  onGo,
}: {
  sessionId: string
  rel: string
  /** The cursor's offset in the file. */
  pos: number
  /** Changes each time F12 is pressed in the file, to go to the definition. */
  ask: number
  onGo: (file: string, line: number) => void
}) {
  const q = (op: string, at?: number) => `/api/files/ts?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(rel)}&op=${op}${at !== undefined ? `&pos=${at}` : ""}`
  const [problems, setProblems] = useState<Problem[]>()
  const [info, setInfo] = useState<string>()
  const [places, setPlaces] = useState<{ what: string; list: Place[] }>()
  const [note, setNote] = useState<string>()
  useEffect(() => {
    setProblems(undefined)
    void api<{ results: Problem[] }>("GET", q("diagnostics")).then((r) => {
      if (r.ok && r.data) setProblems(r.data.results)
      else setNote(r.error ?? "The TypeScript language service could not look at this file.")
    })
    // Only when the file changes (q is made from these).
  }, [sessionId, rel])
  useEffect(() => {
    // What the name at the cursor is, a moment after the cursor stops.
    const t = setTimeout(() => {
      void api<{ result: { text: string } | null }>("GET", q("info", pos)).then((r) => setInfo(r.ok ? (r.data?.result?.text ?? "") : ""))
    }, 250)
    return () => clearTimeout(t)
  }, [pos, sessionId, rel])
  const find = async (op: "definition" | "references") => {
    const r = await api<{ results: Place[] }>("GET", q(op, pos))
    if (!r.ok || !r.data) return setNote(r.error ?? "Not available.")
    const list = r.data.results
    setNote(undefined)
    // One definition: go straight there.
    if (op === "definition" && list.length === 1) return onGo(list[0]!.file, list[0]!.line)
    setPlaces({ what: op === "definition" ? "Definitions" : "References", list })
  }
  useEffect(() => {
    if (ask) void find("definition")
  }, [ask])
  const placeButton = (p: Place, extra?: string) => (
    <button type="button" className="w-full cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-left text-inherit hover:bg-s2" onClick={() => onGo(p.file, p.line)}>
      <span className="mono text-mut">
        {p.file === rel ? "" : `${p.file} `}
        {p.line}:{p.column}
      </span>{" "}
      {extra ?? p.text}
    </button>
  )
  const errors = problems?.filter((p) => p.severity === "error").length ?? 0
  return (
    <section aria-label="TypeScript" className="grid gap-2 border-t border-line p-2 text-[12.5px]">
      <p className="m-0" aria-live="polite">
        <span className="text-mut">At the cursor: </span>
        <span className="mono">{info || "nothing to say"}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => void find("definition")}>
          Go to definition (F12)
        </button>
        <button type="button" className="btn" onClick={() => void find("references")}>
          Find references
        </button>
      </div>
      {note ? <p className="m-0 text-mut">{note}</p> : null}
      {places ? (
        <div>
          <p className="m-0 font-semibold">
            {places.what}: {places.list.length}
          </p>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {places.list.map((p) => (
              <li key={`${p.file}:${p.line}:${p.column}`}>{placeButton(p)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {problems ? (
        <div>
          <p className="m-0 font-semibold">{problems.length ? `Problems: ${errors} error${errors === 1 ? "" : "s"}, ${problems.length - errors} other` : "No problems found."}</p>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {problems.map((p, i) => (
              <li key={i}>{placeButton(p, `${p.severity === "error" ? "Error" : p.severity === "warning" ? "Warning" : "Note"}: ${p.message}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
