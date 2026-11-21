import { useEffect, useState } from "react"
import { changeSize, reviewMinutes } from "@gatehouse/shared/contracts"
import { api } from "../lib/api"

/** D-089: about how long a pending change takes to review, or nothing for a call that changes no file. */
export function reviewEstimate(toolName: string, input: unknown, risk: number): number | undefined {
  const size = changeSize(toolName, input)
  return size.files ? reviewMinutes({ ...size, risk }) : undefined
}

export const minutesWords = (m: number) => (m === 1 ? "about 1 minute" : `about ${m} minutes`)

interface Load {
  lastHour: { minutes: number; changes: number }
  capacity?: number
  over?: boolean
}

/**
 * D-089: the review the last hour's changes need, against the capacity you set in Settings. Says nothing until there
 * is something to say; warns when it is above your capacity.
 */
export function ReviewLoadMeter() {
  const [load, setLoad] = useState<Load>()
  useEffect(() => {
    const read = () => void api<Load>("GET", "/api/review-load").then((r) => r.ok && r.data && setLoad(r.data))
    read()
    const t = setInterval(read, 60_000)
    return () => clearInterval(t)
  }, [])
  if (!load || (!load.lastHour.changes && !load.over)) return null
  const said = `${load.lastHour.changes} change${load.lastHour.changes === 1 ? "" : "s"} in the last hour need ${minutesWords(load.lastHour.minutes)} of review`
  return load.over ? (
    <p role="alert" className="m-0 text-[13px] font-semibold text-warn">
      {said}, more than the {load.capacity} minutes an hour you set. Slow the sessions down, or review in a batch.
    </p>
  ) : (
    <p role="status" className="m-0 text-[13px] text-mut">
      {said}
      {load.capacity ? ` (your capacity: ${load.capacity} an hour)` : ""}.
    </p>
  )
}
