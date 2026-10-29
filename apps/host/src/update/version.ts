/**
 * JCVC versions: major.minor.patch, with an optional -pre part and an optional +build part. A release is
 * 1.0.<commit count>, so a later push always has a higher number. A -pre version sorts before its release, so a
 * build from a working copy with changes (1.0.80-dev) is offered the real 1.0.80. The +build part is ignored.
 */
export interface Version {
  nums: [number, number, number]
  pre?: string
}

const SHAPE =
  /^(\d{1,6})\.(\d{1,6})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/

export function parseVersion(v: string): Version | undefined {
  const m = SHAPE.exec(v.trim())
  if (!m) return undefined
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], ...(m[4] ? { pre: m[4] } : {}) }
}

/** Below zero when a is older than b, zero when they are the same release, above zero when a is newer. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) throw new Error(`Not a JCVC version: ${!x ? a : b}`)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] as number) - (y.nums[i] as number)
    if (d !== 0) return d
  }
  if (x.pre === y.pre) return 0
  if (x.pre === undefined) return 1
  if (y.pre === undefined) return -1
  return x.pre < y.pre ? -1 : 1
}

export const isNewer = (candidate: string, current: string): boolean =>
  compareVersions(candidate, current) > 0
