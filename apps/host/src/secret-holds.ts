import type { Found } from "./commit-scan.js"

/**
 * O59 (owner, 27 Nov): what `secret-in-commit` last held in each repository, and a finding the owner allowed once.
 *
 * - Nothing is cached for the check itself: each commit and push is scanned from git again. This is only what the last
 *   refusal found, kept for this run of Codehouse (never written to disk, never the value), so Settings, Safety can
 *   show it, clear it, and allow one finding once.
 * - Allow once is the owner's, from the desktop only, recorded in the audit log by whoever calls allowOnce. It covers
 *   the next commit or push in that repository that finds exactly that (its kind, file and line), and is used up then.
 * - Every other finding in the same command is still refused, and a new one is never covered.
 */
export interface HeldRepo {
  repo: string
  at: string
  findings: Array<Found & { allowedOnce: boolean }>
}

const MAX_REPOS = 30

/** A finding's identity: the same kind in the same file at the same line, wherever the commit or branch. */
export const findingKey = (f: Pick<Found, "kind" | "file" | "line">): string => [f.kind, f.file, f.line ?? ""].join("\u0000")

/** A repository's path as a key: forward slashes, no trailing slash, lower case on Windows. */
export const repoKey = (repo: string, platform: NodeJS.Platform = process.platform): string => {
  const p = repo.replace(/\\/g, "/").replace(/\/+$/, "")
  return platform === "win32" || platform === "darwin" ? p.toLowerCase() : p
}

export class SecretHolds {
  readonly #held = new Map<string, { repo: string; at: string; findings: Found[] }>()
  readonly #allowed = new Map<string, Set<string>>()
  constructor(private readonly now: () => Date = () => new Date()) {}

  /** A refusal: what it found, for the repository, in place of what was held there before. */
  held(repo: string, findings: Found[]): void {
    const k = repoKey(repo)
    this.#held.delete(k)
    this.#held.set(k, { repo, at: this.now().toISOString(), findings: findings.map((f) => ({ ...f })) })
    while (this.#held.size > MAX_REPOS) this.#held.delete(this.#held.keys().next().value!)
  }

  /**
   * Takes out of `found` each finding allowed once in this repository, using each allowance up. What is left is still
   * refused; `used` is what was let through, for the audit log.
   */
  excuse(repo: string, found: Found[]): { left: Found[]; used: Found[] } {
    const allowed = this.#allowed.get(repoKey(repo))
    if (!allowed?.size) return { left: found, used: [] }
    const left: Found[] = []
    const used: Found[] = []
    for (const f of found) (allowed.has(findingKey(f)) ? used : left).push(f)
    // Used only when the command goes through: with anything left, it is refused and the allowance stays.
    if (!left.length) for (const f of used) allowed.delete(findingKey(f))
    return left.length ? { left, used: [] } : { left, used }
  }

  /** Whether a finding is one held for that repository now. */
  isHeld(repo: string, finding: Pick<Found, "kind" | "file" | "line">): boolean {
    const key = findingKey(finding)
    return this.#held.get(repoKey(repo))?.findings.some((f) => findingKey(f) === key) === true
  }

  /** Allows one held finding once. False when it is not one held for that repository now. */
  allowOnce(repo: string, finding: Pick<Found, "kind" | "file" | "line">): boolean {
    const k = repoKey(repo)
    const held = this.#held.get(k)
    const key = findingKey(finding)
    if (!held?.findings.some((f) => findingKey(f) === key)) return false
    const set = this.#allowed.get(k) ?? new Set<string>()
    set.add(key)
    this.#allowed.set(k, set)
    return true
  }

  /** Forgets what was held in a repository, and any allowance not used yet. */
  clear(repo: string): boolean {
    const k = repoKey(repo)
    const had = this.#held.has(k) || this.#allowed.has(k)
    this.#held.delete(k)
    this.#allowed.delete(k)
    return had
  }

  /** What is held, newest first, each finding marked when it is allowed once. */
  list(): HeldRepo[] {
    return [...this.#held.entries()].reverse().map(([k, h]) => {
      const allowed = this.#allowed.get(k)
      return { repo: h.repo, at: h.at, findings: h.findings.map((f) => ({ ...f, allowedOnce: allowed?.has(findingKey(f)) === true })) }
    })
  }
}
