import { useDepth, type Depth } from "../lib/explain-depth"

export interface ExplanationData {
  trace: Array<{ stage: string; result: string; rules?: string[] }>
  fixed: boolean
  change?: string
}

const NAMES: Record<Depth, string> = { short: "Short", normal: "Normal", full: "Full" }

/**
 * D-020 and D-088: how a decision was reached, at the depth chosen for this area. A floor decision is always shown in
 * full and says it cannot be changed.
 */
export function Explanation({ area, x }: { area: string; x: ExplanationData }) {
  const [depth, setDepth] = useDepth(area)
  const shown = x.fixed ? "full" : depth
  const steps = shown === "full" ? x.trace : shown === "normal" ? x.trace.filter((t) => t.rules?.length || t.stage === "Floor") : []
  return (
    <div className="grid gap-1 text-[12.5px]">
      {x.fixed ? null : (
        <label className="flex items-center gap-2 text-mut">
          <span>Detail</span>
          <select className="field !min-h-7 !py-0 text-[12.5px]" value={depth} onChange={(e) => setDepth(e.target.value as Depth)}>
            {(["short", "normal", "full"] as const).map((d) => (
              <option key={d} value={d}>
                {NAMES[d]}
              </option>
            ))}
          </select>
        </label>
      )}
      {steps.length ? (
        <ol className="m-0 grid gap-0.5 pl-5" aria-label="How it was decided">
          {steps.map((t, i) => (
            <li key={i}>
              <span className="text-mut">{t.stage}:</span> {t.result}
            </li>
          ))}
        </ol>
      ) : null}
      <span className={x.fixed ? "font-semibold" : undefined}>
        {x.fixed ? "Cannot be changed: the floor decides this, and no rule, setting or approval overrides it." : `What would change it: ${x.change ?? ""}`}
      </span>
    </div>
  )
}
