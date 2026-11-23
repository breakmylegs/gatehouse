import { useState } from "react"
import type { Drill } from "../lib/drills"

/** E-074: code reading drills from the tours; each answer gets an explanation and a link to its code. */
export function Drills({ drills, onOpen, onAnswer }: { drills: Drill[]; onOpen: (file: string, line: number) => void; onAnswer?: (d: Drill, right: boolean) => void }) {
  const [picked, setPicked] = useState<Record<string, number>>({})
  if (!drills.length) return <p className="m-0 text-mut">Drills need a tour with at least two steps the code still has.</p>
  const answered = Object.keys(picked).length
  const right = drills.filter((d) => picked[d.id] === d.answer).length
  return (
    <div className="grid gap-2">
      <p className="m-0 text-mut" role="status">
        {answered ? `${right} of ${answered} answered right.` : `${drills.length} questions from the tours.`}
      </p>
      <ol className="m-0 grid gap-2 pl-5">
        {drills.map((d) => {
          const p = picked[d.id]
          return (
            <li key={d.id} className="grid gap-1">
              <span>
                {d.prompt}{" "}
                <button type="button" className="link text-[12px]" onClick={() => onOpen(d.link.file, d.link.line)}>
                  (the code)
                </button>
              </span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={d.prompt}>
                {d.choices.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    className={`btn !min-h-7 text-left ${p === undefined ? "" : i === d.answer ? "btn-primary" : p === i ? "btn-deny" : ""}`}
                    disabled={p !== undefined}
                    onClick={() => {
                      setPicked({ ...picked, [d.id]: i })
                      onAnswer?.(d, i === d.answer)
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {p !== undefined ? (
                <span className={p === d.answer ? "" : "font-semibold"}>
                  {p === d.answer ? "Right. " : "Not quite. "}
                  {d.explanation}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
