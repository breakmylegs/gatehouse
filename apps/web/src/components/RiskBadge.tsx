import clsx from "clsx"
import { riskBand, type RiskBand } from "../lib/format"

const SHAPES: Record<RiskBand, string> = {
  Low: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z",
  Moderate: "M8 1.5 14.5 8 8 14.5 1.5 8z",
  High: "M8 1.5 15 14H1z",
  Severe: "M5 1.5h6L14.5 5v6L11 14.5H5L1.5 11V5z",
}
const COLOUR: Record<RiskBand, string> = {
  Low: "text-ok",
  Moderate: "text-warn",
  High: "text-sev",
  Severe: "text-sev",
}

/** Risk is always a word, a number and a shape. Colour only reinforces it. */
export function RiskBadge({ risk, className }: { risk: number; className?: string }) {
  const band = riskBand(risk)
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border border-current py-px pl-1.5 pr-2.5 font-semibold",
        COLOUR[band],
        className,
      )}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d={SHAPES[band]}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {band === "High" || band === "Severe" ? (
          <path d="M8 6v4M8 12v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ) : null}
      </svg>
      {band} risk {risk}
    </span>
  )
}
