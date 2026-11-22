import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Finding {
  file: string
  line: number
  kind: "email" | "uk-phone" | "ni-number" | "card"
  sample: string
}
interface Generated {
  sql: string
  rows: Record<string, number>
  refused: string[]
  notRun?: string
}

const KIND: Record<Finding["kind"], string> = {
  email: "an email address at a real domain",
  "uk-phone": "a UK phone number outside the drama ranges",
  "ni-number": "a National Insurance number",
  card: "a card number that passes the Luhn check",
}

/** E-015: real-looking personal data in the project's fixtures, and synthetic seed rows made from its schema. */
export function TestDataPanel({ sessionId, onOpen, onClose }: { sessionId: string; onOpen: (file: string, line: number) => void; onClose: () => void }) {
  const [findings, setFindings] = useState<Finding[]>()
  const [generated, setGenerated] = useState<Generated>()
  const [error, setError] = useState<string>()
  const [making, setMaking] = useState(false)
  useEffect(() => {
    void send({ type: "test_data", sessionId }).then((x) => (x.ok ? setFindings((x.data as { findings: Finding[] }).findings) : setError(x.error?.message ?? "The fixtures could not be read")))
  }, [sessionId])
  async function generate() {
    setMaking(true)
    const x = await send({ type: "test_data", sessionId, generate: true })
    setMaking(false)
    if (!x.ok) return void toast.error(x.error?.message ?? "No rows were made", { id: "test-data" })
    setGenerated((x.data as { generated?: Generated }).generated)
  }
  return (
    <section aria-label="Test data" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Test data</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p className="m-0 text-mut">{error}</p>
      ) : !findings ? (
        <p className="m-0 text-mut">Reading the fixtures…</p>
      ) : !findings.length ? (
        <p className="m-0 text-mut">Nothing in the fixtures looks like a real person's data.</p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0">
          {findings.map((f) => (
            <li key={`${f.file}:${f.line}:${f.kind}:${f.sample}`} className="break-words">
              <button type="button" className="link" onClick={() => onOpen(f.file, f.line)}>
                {f.file}:{f.line}
              </button>{" "}
              has {KIND[f.kind]} (<span className="mono">{f.sample}</span>)
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn !min-h-7" disabled={making} onClick={() => void generate()}>
          {making ? "Making rows…" : "Make synthetic seed rows"}
        </button>
        <span className="text-xs text-mut">The same rows each time, from the schema the migrations build, checked by SQLite.</span>
      </div>
      {generated ? (
        generated.notRun ? (
          <p className="m-0">{generated.notRun}</p>
        ) : (
          <div className="grid gap-1">
            <p className="m-0 text-mut">
              {Object.entries(generated.rows)
                .map(([t, n]) => `${t}: ${n}`)
                .join(", ")}
              {generated.refused.length ? `. ${generated.refused.length} row(s) SQLite would not take: ${generated.refused.slice(0, 3).join("; ")}` : ""}
            </p>
            <pre className="mono m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words">{generated.sql}</pre>
            <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => void navigator.clipboard.writeText(generated.sql).then(() => toast("Copied", { id: "test-data" }))}>
              Copy
            </button>
          </div>
        )
      ) : null}
    </section>
  )
}
