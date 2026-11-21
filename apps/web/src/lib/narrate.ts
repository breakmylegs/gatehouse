import type { KeyboardEvent } from "react"
import { riskBand } from "./format"

/**
 * D-091, narrated diffs: each change in a file read out as one sentence in a fixed order, file, which change, what kind,
 * where and how many lines, then its risk, so a screen reader hears the same shape every time. The arrow keys (and
 * Home and End) move between the changes of a file.
 */
export interface NarratedHunk {
  beforeStart: number
  beforeLines: number
  afterStart: number
  afterLines: number
}

const lines = (n: number) => (n === 1 ? "1 line" : `${n} lines`)

export function narrate(path: string, h: NarratedHunk, index: number, count: number, risk?: number): string {
  const kind = h.beforeLines === 0 ? "added" : h.afterLines === 0 ? "removed" : "changed"
  const where =
    kind === "removed"
      ? `before line ${h.afterStart}`
      : h.afterLines === 1
        ? `line ${h.afterStart}`
        : `lines ${h.afterStart} to ${h.afterStart + h.afterLines - 1}`
  const size = kind === "added" ? `${lines(h.afterLines)} added` : kind === "removed" ? `${lines(h.beforeLines)} removed` : `${lines(h.afterLines)} now, ${lines(h.beforeLines)} before`
  const said = risk === undefined ? "risk not known" : `${riskBand(risk)} risk`
  return `${path}, change ${index + 1} of ${count}: ${kind}, ${where}, ${size}, ${said}.`
}

/** Arrow keys, Home and End on a change move to the next, previous, first or last change of the same list. */
export function moveBetweenHunks(e: KeyboardEvent<HTMLElement>): void {
  if (e.target !== e.currentTarget) return
  const items = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-hunk]") ?? [])]
  const at = items.indexOf(e.currentTarget)
  const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1
  if (to < 0 || to >= items.length || to === at) return
  e.preventDefault()
  items[to]!.focus()
}
