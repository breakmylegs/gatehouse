/**
 * T-075 (t3code review, safe variant): what the Pull requests page can do to a pull request. Each is one gh command
 * made here from fixed words and checked values (a number, GitHub logins, a merge method, a file Codehouse wrote), run
 * as a Codehouse action: judged by the policy exactly as the same command from the session would be (gh writes ask,
 * rule git-remote), on the approval card, recorded, and stopped by the kill switch. Text you write (a comment, the
 * description with a box ticked) goes in a file, never into the command line.
 */
export type PrAction =
  | { kind: "comment"; bodyFile: string }
  | { kind: "request-reviewers"; logins: string[] }
  | { kind: "checkout" }
  | { kind: "merge"; method: "merge" | "squash" | "rebase" }
  | { kind: "auto-merge"; on: boolean; method: "merge" | "squash" | "rebase" }
  | { kind: "revert" }
  | { kind: "edit-body"; bodyFile: string }
  /** T-081: GitHub rebases the branch onto its base itself, so nothing is force-pushed from here. */
  | { kind: "update-branch" }

export class PrActionError extends Error {}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]{1,100})?$/
const METHODS = new Set(["merge", "squash", "rebase"])
/** A file path as one PowerShell or Bash word: Codehouse's own temp files only, so no quote can be in it. */
const SAFE_PATH = /^[A-Za-z0-9 _:\\/.()~-]{1,400}$/

export function prNumber(v: unknown): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > 10_000_000) throw new PrActionError("That is not a pull request number.")
  return n
}

/** The gh command for an action on pull request `n`, and what it is for in words. */
export function prCommand(n: number, a: PrAction): { command: string; why: string } {
  const num = prNumber(n)
  const file = (p: string) => {
    if (!SAFE_PATH.test(p)) throw new PrActionError("That file cannot be named in a command.")
    return `"${p}"`
  }
  switch (a.kind) {
    case "comment":
      return { command: `gh pr comment ${num} --body-file ${file(a.bodyFile)}`, why: `your comment on pull request ${num}` }
    case "request-reviewers": {
      const logins = [...new Set(a.logins.map((l) => l.trim()).filter(Boolean))]
      if (!logins.length || logins.length > 15 || !logins.every((l) => LOGIN.test(l))) throw new PrActionError("Name reviewers by their GitHub logins (or org/team), separated by commas.")
      return { command: `gh pr edit ${num} --add-reviewer ${logins.join(",")}`, why: `asking ${logins.join(", ")} to review pull request ${num}` }
    }
    case "checkout":
      return { command: `gh pr checkout ${num}`, why: `checking out pull request ${num}` }
    case "merge":
      if (!METHODS.has(a.method)) throw new PrActionError("Merge, squash or rebase.")
      return { command: `gh pr merge ${num} --${a.method}`, why: `merging pull request ${num} (${a.method})` }
    case "auto-merge":
      if (!METHODS.has(a.method)) throw new PrActionError("Merge, squash or rebase.")
      return a.on
        ? { command: `gh pr merge ${num} --auto --${a.method}`, why: `merging pull request ${num} once its checks pass` }
        : { command: `gh pr merge ${num} --disable-auto`, why: `no longer merging pull request ${num} by itself` }
    case "revert":
      return { command: `gh pr revert ${num}`, why: `opening a pull request that reverts ${num}` }
    case "update-branch":
      return { command: `gh pr update-branch ${num} --rebase`, why: `rebasing pull request ${num} onto its base on GitHub` }
    case "edit-body":
      return { command: `gh pr edit ${num} --body-file ${file(a.bodyFile)}`, why: `changing the description of pull request ${num}` }
  }
}

/** The description with its n-th task box (0-based, in order) ticked or unticked; unchanged when there is none. */
export function toggleTask(body: string, index: number, on: boolean): string {
  let i = -1
  return body.replace(/^(\s*[-*+]\s+)\[( |x|X)\]/gm, (m, lead: string) => {
    i++
    return i === index ? `${lead}[${on ? "x" : " "}]` : m
  })
}

