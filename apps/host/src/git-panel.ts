/**
 * The git panel (backlog G36): a session's repository as git sees it. History (the graph, up to 10,000 commits) and
 * blame only read. Staging a single change and marking a conflict resolved change only git's index, each one shown
 * before it is done and recorded; nothing here commits, pushes, merges or rewrites history. Git runs without a shell,
 * every argument fixed or checked, with a time limit.
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import type { HostAudit } from "./hostaudit.js"

export class GitPanelError extends Error {}

type Git = (cwd: string, args: string[], input?: string) => Promise<string>

const git: Git = (cwd, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-c", "core.quotepath=off", ...args],
      { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024 * 1024 },
      (e, stdout, stderr) =>
        e
          ? reject(
              new GitPanelError(
                String(stderr || e.message)
                  .trim()
                  .slice(0, 400),
              ),
            )
          : resolve(String(stdout)),
    )
    if (input !== undefined) child.stdin?.end(input)
  })

export const MAX_COMMITS = 10_000

export interface HistoryLine {
  /** The graph drawn by git, such as "* " or "| * ". */
  graph: string
  hash?: string
  subject?: string
  author?: string
  date?: string
  refs?: string
}

/** The graph and its commits, newest first, up to MAX_COMMITS. */
export async function history(cwd: string, run: Git = git): Promise<HistoryLine[]> {
  const out = await run(cwd, [
    "log",
    "--graph",
    "--all",
    "--date=short",
    `--max-count=${MAX_COMMITS}`,
    "--format=%x1f%h%x1f%s%x1f%an%x1f%ad%x1f%D",
  ])
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const at = l.indexOf("\x1f")
      if (at < 0) return { graph: l }
      const [hash, subject, author, date, refs] = l.slice(at + 1).split("\x1f")
      return {
        graph: l.slice(0, at),
        hash: hash ?? "",
        subject: subject ?? "",
        author: author ?? "",
        date: date ?? "",
        ...(refs ? { refs } : {}),
      }
    })
}

/** A path inside the repository, never an option or a way out of it. */
const PATH = /^(?!-)(?!.*(^|[\\/])\.\.([\\/]|$))[^\0]{1,1000}$/

function checkPath(p: unknown): string {
  if (typeof p !== "string" || !PATH.test(p) || /^([A-Za-z]:|[\\/])/.test(p))
    throw new GitPanelError("That is not a path in this repository.")
  return p.replace(/\\/g, "/")
}

export interface BlameLine {
  line: number
  hash: string
  author: string
  date: string
  summary: string
  text: string
}

/** Who last changed each line of a file, and in which commit. */
export async function blame(cwd: string, file: unknown, run: Git = git): Promise<BlameLine[]> {
  const out = await run(cwd, ["blame", "--line-porcelain", "--", checkPath(file)])
  const lines: BlameLine[] = []
  let cur: Partial<BlameLine> = {}
  for (const l of out.split("\n")) {
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l)
    if (head) cur = { hash: head[1]!.slice(0, 8), line: Number(head[2]) }
    else if (l.startsWith("author ")) cur.author = l.slice(7)
    else if (l.startsWith("author-time "))
      cur.date = new Date(Number(l.slice(12)) * 1000).toISOString().slice(0, 10)
    else if (l.startsWith("summary ")) cur.summary = l.slice(8)
    else if (l.startsWith("\t")) {
      lines.push({
        line: cur.line ?? lines.length + 1,
        hash: cur.hash ?? "",
        author: cur.author ?? "",
        date: cur.date ?? "",
        summary: cur.summary ?? "",
        text: l.slice(1),
      })
    }
  }
  return lines
}

export interface Hunk {
  /** Its place in the file's diff, to stage it by. */
  index: number
  header: string
  lines: string[]
}

export interface FileHunks {
  path: string
  staged: boolean
  hunks: Hunk[]
}

/** Each changed file's hunks, not staged and staged, from git's own diff. */
export async function changes(cwd: string, run: Git = git): Promise<FileHunks[]> {
  const parse = (diff: string, staged: boolean): FileHunks[] => {
    const files: FileHunks[] = []
    let file: FileHunks | undefined
    let hunk: Hunk | undefined
    for (const l of diff.split("\n")) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(l)
      if (m) {
        file = { path: m[2]!, staged, hunks: [] }
        files.push(file)
        hunk = undefined
      } else if (file && l.startsWith("@@")) {
        hunk = { index: file.hunks.length, header: l, lines: [] }
        file.hunks.push(hunk)
      } else if (
        hunk &&
        (l.startsWith("+") || l.startsWith("-") || l.startsWith(" ") || l.startsWith("\\"))
      )
        hunk.lines.push(l)
    }
    return files
  }
  const [unstaged, staged] = await Promise.all([
    run(cwd, ["diff", "--no-color", "--no-ext-diff", "-U3"]),
    run(cwd, ["diff", "--cached", "--no-color", "--no-ext-diff", "-U3"]),
  ])
  return [...parse(unstaged, false), ...parse(staged, true)]
}

/** The patch for one hunk of one file, as git apply takes it. */
async function hunkPatch(
  cwd: string,
  file: string,
  index: number,
  staged: boolean,
  run: Git,
): Promise<string> {
  const diff = await run(cwd, [
    "diff",
    ...(staged ? ["--cached"] : []),
    "--no-color",
    "--no-ext-diff",
    "-U3",
    "--",
    file,
  ])
  const lines = diff.split("\n")
  const first = lines.findIndex((l) => l.startsWith("@@"))
  if (first < 0) throw new GitPanelError("That file has no changes to stage.")
  const head = lines.slice(0, first)
  const hunks: string[][] = []
  for (const l of lines.slice(first)) {
    if (l.startsWith("@@")) hunks.push([l])
    else hunks.at(-1)?.push(l)
  }
  const hunk = hunks[index]
  if (!hunk) throw new GitPanelError("That change is not there any more. Look again.")
  return [...head, ...hunk.filter((l, i) => i === 0 || l !== "")].join("\n") + "\n"
}

/** Stages one hunk (or unstages one already staged): git's index only, the files are left as they are. */
export async function stageHunk(
  cwd: string,
  file: unknown,
  index: unknown,
  unstage: boolean,
  run: Git = git,
): Promise<void> {
  const p = checkPath(file)
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0)
    throw new GitPanelError("Say which change.")
  const patch = await hunkPatch(cwd, p, index, unstage, run)
  await run(cwd, ["apply", "--cached", ...(unstage ? ["--reverse"] : []), "--recount", "-"], patch)
}

/** The files with a merge conflict still in them. */
export async function conflicts(cwd: string, run: Git = git): Promise<string[]> {
  return (await run(cwd, ["diff", "--name-only", "--diff-filter=U"])).split(/\r?\n/).filter(Boolean)
}

/** Marks a conflicted file resolved (git add), only once no conflict markers are left in it. */
export async function markResolved(
  cwd: string,
  file: unknown,
  text: string,
  run: Git = git,
): Promise<void> {
  const p = checkPath(file)
  if (!(await conflicts(cwd, run)).includes(p))
    throw new GitPanelError("That file has no conflict.")
  if (/^(<{7}|={7}|>{7})( |$)/m.test(text))
    throw new GitPanelError(
      "Conflict markers are still in the file. Resolve them first, then save.",
    )
  await run(cwd, ["add", "--", p])
}

export interface GitPanelContext {
  sessionCwd?: (sessionId: string) => string | undefined
  audit: HostAudit
}

/**
 * GET /api/git/history, /api/git/blame, /api/git/changes and /api/git/conflicts read; POST /api/git/stage and
 * /api/git/resolve change git's index only, each recorded first (not recorded, not done).
 */
export function registerGitPanelRoutes(app: FastifyInstance, ctx: GitPanelContext): void {
  const bad = (
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    n: number,
    error: string,
  ) => reply.code(n).send({ error })
  const cwdOf = (q: Record<string, unknown>) =>
    typeof q.session === "string" ? ctx.sessionCwd?.(q.session) : undefined
  const reading =
    (fn: (cwd: string, q: Record<string, unknown>) => Promise<unknown>) =>
    async (req: { query: unknown }, reply: Parameters<typeof bad>[0]) => {
      const q = req.query as Record<string, unknown>
      const cwd = cwdOf(q)
      if (!cwd) return bad(reply, 404, "That session is not running.")
      try {
        return await fn(cwd, q)
      } catch (e) {
        return bad(reply, e instanceof GitPanelError ? 409 : 500, (e as Error).message)
      }
    }
  app.get(
    "/api/git/history",
    reading(async (cwd) => ({ lines: await history(cwd) })),
  )
  app.get(
    "/api/git/blame",
    reading(async (cwd, q) => ({ lines: await blame(cwd, q.path) })),
  )
  app.get(
    "/api/git/changes",
    reading(async (cwd) => ({ files: await changes(cwd) })),
  )
  app.get(
    "/api/git/conflicts",
    reading(async (cwd) => ({ files: await conflicts(cwd) })),
  )

  const record = (
    session: string,
    cwd: string,
    event: string,
    input: Record<string, unknown>,
    reason: string,
  ) =>
    ctx.audit.record({
      session,
      event,
      channel: "desktop",
      tool: "git",
      cwd,
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replace(/_/g, "-"),
        reason,
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
  app.post("/api/git/stage", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const cwd = cwdOf(b)
    if (!cwd) return bad(reply, 404, "That session is not running.")
    const unstage = b.unstage === true
    if (
      !(await record(
        String(b.session),
        cwd,
        unstage ? "git_unstaged" : "git_staged",
        { path: b.path, hunk: b.index },
        unstage
          ? "You unstaged one change from the desktop."
          : "You staged one change from the desktop.",
      ))
    )
      return bad(reply, 503, "It could not be recorded, so nothing was staged.")
    try {
      await stageHunk(cwd, b.path, b.index, unstage)
      return { ok: true }
    } catch (e) {
      return bad(reply, e instanceof GitPanelError ? 409 : 500, (e as Error).message)
    }
  })
  app.post("/api/git/resolve", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const cwd = cwdOf(b)
    if (!cwd) return bad(reply, 404, "That session is not running.")
    let text: string
    try {
      // The file as it is on disk, not as the screen says: the markers are looked for in what git will take.
      text = fs.readFileSync(path.join(cwd, checkPath(b.path)), "utf8")
    } catch (e) {
      return bad(reply, e instanceof GitPanelError ? 409 : 404, (e as Error).message)
    }
    if (
      !(await record(
        String(b.session),
        cwd,
        "git_resolved",
        { path: b.path },
        "You marked a merge conflict resolved from the desktop.",
      ))
    )
      return bad(reply, 503, "It could not be recorded, so it was not marked resolved.")
    try {
      await markResolved(cwd, b.path, text)
      return { ok: true }
    } catch (e) {
      return bad(reply, e instanceof GitPanelError ? 409 : 500, (e as Error).message)
    }
  })
}
