import clsx from "clsx"
import { riskBand, type RiskBand } from "../lib/format"

/** The Stitch risk shapes (owner, 1 Nov): a diamond, a triangle, a hexagon and a solid square. */
const SHAPES: Record<RiskBand, string> = {
  Low: "M8 1.8 14.2 8 8 14.2 1.8 8z",
  Moderate: "M8 2 14.5 13.8H1.5z",
  High: "M4.6 2h6.8L15 8l-3.6 6H4.6L1 8z",
  Severe: "M2.5 2.5h11v11h-11z",
}

/** Risk is always a word, a number and a shape. Colour and the tint only reinforce it. */
export function RiskBadge({ risk, className }: { risk: number; className?: string }) {
  const band = riskBand(risk)
  return (
    <span className={clsx("risk-badge", `risk-${band.toLowerCase()}`, className)}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path
          d={SHAPES[band]}
          fill={band === "Severe" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      {band} risk {risk}
    </span>
  )
}
