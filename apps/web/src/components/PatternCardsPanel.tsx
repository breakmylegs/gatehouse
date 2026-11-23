import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Card {
  topic: string
  summary: string
  examples: Array<{ file: string; line: number; text: string }>
}

/** E-076: how this repository handles errors, logging, configuration and tests, each with real examples. */
export function PatternCardsPanel({ sessionId, onOpen, onClose }: { sessionId: string; onOpen: (file: string, line: number) => void; onClose: () => void }) {
  const [r, setR] = useState<{ cards: Card[]; markdown: string }>()
  useEffect(() => {
    void send({ type: "pattern_cards", sessionId }, 120_000).then((x) => (x.ok ? setR(x.data as NonNullable<typeof r>) : toast.error(x.error?.message ?? "Not read", { id: "patterns" })))
  }, [sessionId])
  async function save() {
    const x = await send({ type: "pattern_cards", sessionId, save: true }, 120_000)
    if (x.ok) toast("Saved as .codehouse/patterns.md", { id: "patterns" })
    else toast.error(x.error?.message ?? "Not saved", { id: "patterns" })
  }
  async function tell() {
    if (!r) return
    const x = await send({ type: "prompt", sessionId, text: `Follow these patterns of this repository in what you write:\n\n${r.markdown}` })
    if (!x.ok) toast.error(x.error?.message ?? "Not sent", { id: "patterns" })
  }
  return (
    <section aria-label="Pattern cards" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">How this repository does things</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {!r ? (
        <p className="m-0 text-mut">Reading the code…</p>
      ) : !r.cards.length ? (
        <p className="m-0 text-mut">No pattern has two examples yet.</p>
      ) : (
        r.cards.map((c) => (
          <div key={c.topic} className="grid gap-0.5 border-t border-line pt-1.5">
            <strong>{c.topic}</strong>
            <span>{c.summary}</span>
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {c.examples.map((e) => (
                <li key={`${e.file}:${e.line}`}>
                  <button type="button" className="link" onClick={() => onOpen(e.file, e.line)}>
                    {e.file}:{e.line}
                  </button>{" "}
                  <code className="text-mut">{e.text}</code>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {r?.cards.length ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn !min-h-7" onClick={() => void save()}>
            Save for agents (.codehouse/patterns.md)
          </button>
          <button type="button" className="btn !min-h-7" onClick={() => void tell()}>
            Give them to this session
          </button>
        </div>
      ) : null}
    </section>
  )
}
