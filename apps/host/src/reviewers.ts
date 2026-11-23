/**
 * E-079, reviewer suggestions (Expansion E6). Who should review a change: the people who have worked on the files it
 * touches, from git history, each commit weighted by how recent it is (its weight halves every 90 days), so someone
 * who knows the code now counts for more than someone who wrote it years ago. You are left out, and so are
 * Codehouse's own and bots' commits. Each suggestion says which of the files they know.
 */
import { execFile } from "node:child_process"

export interface Commit {
  name: string
  email: string
  /** Seconds since 1970. */
  at: number
}

export interface Suggestion {
  name: string
  email: string
  score: number
  files: string[]
  last: string
}

const HALF_LIFE_DAYS = 90
const BOT = /\[bot\]|^codehouse@|noreply@github\.com$|dependabot|renovate/i

export function suggestReviewers(history: Record<string, Commit[]>, me: string | undefined, now = Date.now(), top = 3): Suggestion[] {
  const by = new Map<string, Suggestion & { lastAt: number }>()
  for (const [file, commits] of Object.entries(history))
    for (const c of commits) {
      const email = c.email.toLowerCase()
      if (BOT.test(email) || BOT.test(c.name) || (me && email === me.toLowerCase())) continue
      const ageDays = Math.max(0, (now - c.at * 1000) / 86_400_000)
      const w = 0.5 ** (ageDays / HALF_LIFE_DAYS)
      const s = by.get(email) ?? { name: c.name, email, score: 0, files: [], last: "", lastAt: 0 }
      s.score += w
      if (!s.files.includes(file)) s.files.push(file)
      if (c.at > s.lastAt) {
        s.lastAt = c.at
        s.name = c.name
        s.last = new Date(c.at * 1000).toISOString().slice(0, 10)
      }
      by.set(email, s)
    }
  return [...by.values()]
    .sort((a, b) => b.score - a.score || b.lastAt - a.lastAt)
    .slice(0, top)
    .map(({ lastAt: _lastAt, ...s }) => ({ ...s, score: Math.round(s.score * 100) / 100 }))
}

const git = (cwd: string, args: string[]) =>
  new Promise<string | undefined>((resolve) => execFile("git", args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (e, out) => resolve(e ? undefined : String(out))))

/** Each file's commits (author, email, time), the last 200; and who you are in git. */
export async function historyOf(root: string, files: string[]): Promise<{ history: Record<string, Commit[]>; me?: string }> {
  const history: Record<string, Commit[]> = {}
  for (const f of files.slice(0, 100)) {
    const out = (await git(root, ["log", "--no-merges", "-n", "200", "--format=%an%x00%ae%x00%at", "--", f])) ?? ""
    history[f] = out
      .split("\n")
      .map((l) => l.split("\x00"))
      .filter((p) => p.length === 3 && p[2])
      .map(([name, email, at]) => ({ name: name!, email: email!, at: Number(at) }))
  }
  const me = (await git(root, ["config", "user.email"]))?.trim()
  return { history, ...(me ? { me } : {}) }
}
