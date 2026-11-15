import { execFile } from "node:child_process"
import { sanitiseEnv } from "@gatehouse/shared"

/**
 * T-061 (t3code review, O31): a read-only GitHub connection through the gh command line and its own sign-in, so
 * Codehouse holds no token. Off until you switch it on (Settings, owner decision 9 Nov). It only reads pull requests
 * and their checks for a session's repository; anything that writes (a comment, a merge, a push) stays a call of
 * Claude's through the Approver. gh runs without a shell, with fixed arguments and a time limit; what it returns is
 * others' words, shown as text and never given to Claude as instructions.
 */
export class ForgeError extends Error {}

export type Gh = (cwd: string, args: string[]) => Promise<string>

const gh: Gh = (cwd, args) =>
  new Promise((resolve, reject) =>
    execFile(
      "gh",
      args,
      { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env: sanitiseEnv(process.env) as NodeJS.ProcessEnv },
      (e, out, err) =>
        e
          ? reject(
              new ForgeError(
                /ENOENT/.test(String(e.message))
                  ? "The gh command line is not installed, so GitHub cannot be read."
                  : String(err || e.message).trim().slice(0, 300),
              ),
            )
          : resolve(String(out)),
    ),
  )

export interface PullRequest {
  number: number
  title: string
  state: string
  url: string
  branch: string
  draft: boolean
}

export interface PullRequestDetail extends PullRequest {
  base: string
  review?: string
  mergeable?: string
  checks: Array<{ name: string; state: string }>
}

const LIST_FIELDS = "number,title,state,url,headRefName,isDraft"
const VIEW_FIELDS = `${LIST_FIELDS},baseRefName,reviewDecision,mergeable,statusCheckRollup`

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "")
const parse = (out: string): unknown => {
  try {
    return JSON.parse(out)
  } catch {
    throw new ForgeError("GitHub's answer could not be read.")
  }
}

function asPr(o: Record<string, unknown>): PullRequest {
  return {
    number: typeof o.number === "number" ? o.number : 0,
    title: str(o.title),
    state: str(o.state, 20),
    url: /^https:\/\/github\.com\//.test(str(o.url)) ? str(o.url) : "",
    branch: str(o.headRefName, 200),
    draft: o.isDraft === true,
  }
}

/** The repository's open pull requests, newest first, at most 30. */
export async function listPullRequests(cwd: string, run: Gh = gh): Promise<PullRequest[]> {
  const v = parse(await run(cwd, ["pr", "list", "--state", "open", "--limit", "30", "--json", LIST_FIELDS]))
  return Array.isArray(v) ? v.map((o) => asPr((o ?? {}) as Record<string, unknown>)).filter((p) => p.number > 0) : []
}

/** One pull request with its checks. Only a number is accepted, so nothing else reaches gh's arguments. */
export async function viewPullRequest(cwd: string, number: unknown, run: Gh = gh): Promise<PullRequestDetail> {
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > 10_000_000)
    throw new ForgeError("That is not a pull request number.")
  const o = (parse(await run(cwd, ["pr", "view", String(number), "--json", VIEW_FIELDS])) ?? {}) as Record<string, unknown>
  const roll = Array.isArray(o.statusCheckRollup) ? (o.statusCheckRollup as Array<Record<string, unknown>>) : []
  return {
    ...asPr(o),
    base: str(o.baseRefName, 200),
    ...(str(o.reviewDecision, 40) ? { review: str(o.reviewDecision, 40) } : {}),
    ...(str(o.mergeable, 40) ? { mergeable: str(o.mergeable, 40) } : {}),
    checks: roll.slice(0, 100).map((c) => ({
      name: str(c.name ?? c.context, 200),
      state: str(c.conclusion || c.state || c.status, 40),
    })),
  }
}
