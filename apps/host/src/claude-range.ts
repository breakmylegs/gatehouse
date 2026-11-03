/**
 * The Claude Code versions this Codehouse release was checked with (B04). Codehouse's safety rests on how Claude
 * Code decides a call: the order of hooks, rules and modes, Plan mode, and what a plugin's mod can do (read from
 * 2.1.310's own reference, 2 Nov). A Claude Code outside this range could decide differently, so a session that
 * reports one stops before any tool runs.
 *
 * The range is part of the signed release, like the rest of the app. Sessions only ever run the bundled Claude Code,
 * which changes only when a release updates the Agent SDK; a test then fails until the new version has been checked
 * and written here.
 */
export const CLAUDE_CODE_RANGE = { from: "2.1.310", to: "2.1.310" } as const

const parts = (v: string): number[] | undefined => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number)
  return 0
}

/** Whether a reported version is in the range. Anything that is not a plain version is outside it. */
export function inClaudeRange(version: unknown): boolean {
  if (typeof version !== "string") return false
  const v = parts(version)
  const from = parts(CLAUDE_CODE_RANGE.from)
  const to = parts(CLAUDE_CODE_RANGE.to)
  if (!v || !from || !to) return false
  return compare(v, from) >= 0 && compare(v, to) <= 0
}

/** The range in words. */
export const rangeText = (): string =>
  CLAUDE_CODE_RANGE.from === CLAUDE_CODE_RANGE.to
    ? `Claude Code ${CLAUDE_CODE_RANGE.from}`
    : `Claude Code ${CLAUDE_CODE_RANGE.from} to ${CLAUDE_CODE_RANGE.to}`
