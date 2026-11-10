import { useEffect, useMemo, useState } from "react"
import { api } from "../lib/api"

/**
 * C-031: a file's outline beside its text (functions, classes, methods, types, test cases, JSON keys), and go to
 * symbol: type part of a name to find it. Choosing one shows its line.
 */

export interface OutlineSymbol {
  name: string
  kind: string
  line: number
  endLine: number
  children?: OutlineSymbol[]
}

export function flatten(symbols: OutlineSymbol[], within = ""): Array<OutlineSymbol & { path: string; depth: number }> {
  return symbols.flatMap((s) => {
    const p = within ? `${within} > ${s.name}` : s.name
    return [{ ...s, path: p, depth: within ? within.split(" > ").length : 0 }, ...flatten(s.children ?? [], p)]
  })
}

export function Outline({ sessionId, rel, onGo }: { sessionId: string; rel: string; onGo: (line: number) => void }) {
  const [symbols, setSymbols] = useState<OutlineSymbol[]>()
  const [find, setFind] = useState("")
  useEffect(() => {
    setSymbols(undefined)
    void api<{ symbols: OutlineSymbol[]; language: string | null }>(
      "GET",
      `/api/files/outline?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(rel)}`,
    ).then((r) => setSymbols(r.ok && r.data && r.data.language ? r.data.symbols : []))
  }, [sessionId, rel])
  const flat = useMemo(() => flatten(symbols ?? []), [symbols])
  const shown = find.trim() ? flat.filter((s) => s.path.toLowerCase().includes(find.trim().toLowerCase())) : flat
  if (!symbols?.length) return null
  return (
    <nav aria-label="Outline" className="grid content-start gap-1 border-l border-line p-2 text-[12.5px]">
      <label className="sr-only" htmlFor={`outline-${rel}`}>
        Go to symbol
      </label>
      <input
        id={`outline-${rel}`}
        className="field !min-h-7 text-[12.5px]"
        placeholder="Go to symbol"
        value={find}
        onChange={(e) => setFind(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0]) onGo(shown[0].line)
        }}
      />
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {shown.slice(0, 400).map((s) => (
          <li key={`${s.path}:${s.line}`} style={{ paddingLeft: find.trim() ? 0 : s.depth * 10 }}>
            <button type="button" className="w-full cursor-pointer truncate rounded border-0 bg-transparent px-1 py-0.5 text-left text-inherit hover:bg-s2" onClick={() => onGo(s.line)}>
              <span className="text-mut">{s.kind} </span>
              {find.trim() ? s.path : s.name}
              <span className="text-mut"> {s.line}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
