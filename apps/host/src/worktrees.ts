/**
 * A git worktree for a coding session (B10): a separate checkout of a repository, on a branch of its own, in a folder
 * beside the repository, so a session can work without touching the checkout you use. Codehouse makes the worktree
 * with git itself (no shell, every argument checked), records each one it made, and removes only those, and only the
 * folder: the branch stays, because merging the work back is your choice. A worktree with changes not yet committed
 * is removed only when you say so twice.
 */
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "./hostaudit.js"

export class WorktreeError extends Error {}

export interface WorktreeRecord {
  /** The worktree's folder. */
  path: string
  branch: string
  /** The repository it was made from (its top folder). */
  repo: string
  /** The commit it started from, and the name you gave for it. */
  base: string
  baseName: string
  createdAt: string
}

export interface WorktreeView extends WorktreeRecord {
  /** False when the folder has gone (removed by hand). */
  exists: boolean
  /** Bytes in the folder, not counting git's own files. */
  bytes: number
  /** Files changed and not yet committed. */
  changed: number
  /** Commits on its branch since it started. */
  commits: number
}

/** Runs git with the given arguments, never through a shell. */
function git(cwd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (e, stdout, stderr) => {
        if (e)
          reject(
            new WorktreeError(
              String(stderr || e.message)
                .trim()
                .slice(0, 500),
            ),
          )
        else resolve(String(stdout))
      },
    )
  })
}

/** A branch prefix from Settings: never an option, "..", "//" or a .lock name; git checks the rest. */
export const BRANCH_PREFIX = /^(?![-/.])(?!.*\.\.)(?!.*\/\/)(?!.*\.lock\/?$)[A-Za-z0-9._/-]{1,40}$/

/** A base is a branch, tag or commit name, never an option or a path out of the repository. */
const BASE = /^(?!-)[\w./@^~-]{1,100}$/

/**
 * Where new worktrees go (Settings, Sessions, Worktree location; owner's Settings overhaul, 6 Nov). Absent or beside:
 * <repo>.worktrees/<name>. Inside: <repo>/.codehouse/worktrees/<name>, kept out of git through the repository's own
 * info/exclude, never its .gitignore. A folder: <folder>/<repo name>/<name>, only inside a workspace root, since a
 * session anywhere else could change nothing.
 */
export interface WorktreePlace {
  where: "beside" | "inside" | "folder"
  folder?: string
}

/** Whether `p` is `root` or inside it, as Windows compares paths. */
function within(root: string, p: string): boolean {
  const rel = path.relative(path.resolve(root).toLowerCase(), path.resolve(p).toLowerCase())
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

export class Worktrees {
  readonly #file: string
  readonly #place: () => WorktreePlace | undefined
  readonly #roots: () => string[]
  readonly #prefix: () => string | undefined

  constructor(
    dataDir: string,
    o: {
      place?: () => WorktreePlace | undefined
      roots?: () => string[]
      /** Settings, Pull requests: what each new branch's name starts with. Absent or unusable: codehouse/. */
      branchPrefix?: () => string | undefined
    } = {},
  ) {
    this.#file = path.join(dataDir, "worktrees.json")
    this.#place = o.place ?? (() => undefined)
    this.#roots = o.roots ?? (() => [])
    this.#prefix = o.branchPrefix ?? (() => undefined)
  }

  /** The folder a new worktree of `repo` called `name` goes in, from Settings. */
  async #where(repo: string, name: string): Promise<string> {
    const place = this.#place()
    if (place?.where === "inside") {
      const exclude = path.resolve(
        repo,
        (await git(repo, ["rev-parse", "--git-path", "info/exclude"])).trim(),
      )
      const line = "/.codehouse/worktrees/"
      const now = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : ""
      if (!now.split(/\r?\n/).includes(line)) {
        fs.mkdirSync(path.dirname(exclude), { recursive: true })
        fs.appendFileSync(exclude, `${now && !now.endsWith("\n") ? "\n" : ""}${line}\n`)
      }
      return path.join(repo, ".codehouse", "worktrees", name)
    }
    if (place?.where === "folder" && place.folder) {
      const folder = path.resolve(place.folder)
      if (!path.isAbsolute(place.folder) || !this.#roots().some((r) => within(r, folder)))
        throw new WorktreeError(
          "The worktree folder in Settings is outside your workspace roots, so a session there could change nothing. Choose one inside them, or put worktrees beside the project.",
        )
      return path.join(folder, path.basename(repo), name)
    }
    return path.join(path.dirname(repo), `${path.basename(repo)}.worktrees`, name)
  }

  /** Every worktree Codehouse made, as recorded. Read tolerantly: a newer version's fields are kept. */
  records(): WorktreeRecord[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.#file, "utf8")) as { worktrees?: unknown }
      return Array.isArray(v.worktrees)
        ? (v.worktrees as WorktreeRecord[]).filter(
            (w) => typeof w?.path === "string" && typeof w.repo === "string",
          )
        : []
    } catch {
      return []
    }
  }

  async #save(list: WorktreeRecord[]): Promise<void> {
    let kept: Record<string, unknown> = {}
    try {
      kept = JSON.parse(fs.readFileSync(this.#file, "utf8")) as Record<string, unknown>
    } catch {
      // no file yet
    }
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(this.#file, JSON.stringify({ ...kept, worktrees: list }, null, 2) + "\n")
  }

  /**
   * Makes a worktree of the repository that holds `folder`, from `base` (its current commit when absent), where
   * Settings says (beside the repository unless told otherwise), on the branch codehouse/<name>.
   */
  async create(folder: string, base?: string): Promise<WorktreeRecord> {
    const baseName = base?.trim() || "HEAD"
    if (!BASE.test(baseName))
      throw new WorktreeError(`"${baseName.slice(0, 40)}" is not a branch, tag or commit name.`)
    let repo: string
    try {
      repo = path.resolve((await git(folder, ["rev-parse", "--show-toplevel"])).trim())
    } catch {
      throw new WorktreeError(
        "That folder is not in a git repository, so it cannot have a worktree.",
      )
    }
    let commit: string
    try {
      commit = (
        await git(repo, [
          "rev-parse",
          "--verify",
          "--quiet",
          "--end-of-options",
          `${baseName}^{commit}`,
        ])
      ).trim()
    } catch {
      throw new WorktreeError(
        `There is no branch, tag or commit called ${baseName} in that repository.`,
      )
    }
    if (!/^[0-9a-f]{40,64}$/.test(commit))
      throw new WorktreeError(
        `There is no branch, tag or commit called ${baseName} in that repository.`,
      )
    const name = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`
    const where = await this.#where(repo, name)
    const asked = this.#prefix()
    const branch = `${asked && BRANCH_PREFIX.test(asked) ? asked : "codehouse/"}${name}`
    fs.mkdirSync(path.dirname(where), { recursive: true })
    await git(repo, ["worktree", "add", "-b", branch, "--", where, commit], 180_000)
    const rec: WorktreeRecord = {
      path: where,
      branch,
      repo,
      base: commit,
      baseName,
      createdAt: new Date().toISOString(),
    }
    await this.#save([...this.records(), rec])
    return rec
  }

  /** Each recorded worktree with its disk use, changes and commits. */
  async list(): Promise<WorktreeView[]> {
    return Promise.all(
      this.records().map(async (w): Promise<WorktreeView> => {
        const exists = fs.existsSync(w.path)
        if (!exists) return { ...w, exists, bytes: 0, changed: 0, commits: 0 }
        const changed = await git(w.path, ["status", "--porcelain"])
          .then((s) => s.split(/\r?\n/).filter(Boolean).length)
          .catch(() => 0)
        const commits = await git(w.path, ["rev-list", "--count", `${w.base}..HEAD`])
          .then((s) => Number(s.trim()) || 0)
          .catch(() => 0)
        return { ...w, exists, bytes: folderBytes(w.path), changed, commits }
      }),
    )
  }

  /**
   * Removes a worktree Codehouse made: its folder only, never its branch. One with uncommitted changes is kept
   * unless `force` is given.
   */
  async remove(folder: string, o: { force?: boolean } = {}): Promise<WorktreeRecord> {
    const list = this.records()
    const rec = list.find((w) => samePath(w.path, folder))
    if (!rec)
      throw new WorktreeError("Codehouse did not make that worktree, so it does not remove it.")
    if (fs.existsSync(rec.path)) {
      const changed = await git(rec.path, ["status", "--porcelain"])
        .then((s) => s.split(/\r?\n/).filter(Boolean).length)
        .catch(() => 0)
      if (changed && !o.force)
        throw new WorktreeError(
          `It has ${changed === 1 ? "1 changed file" : `${changed} changed files`} not committed. Commit them, or choose Remove anyway.`,
        )
      await git(rec.repo, ["worktree", "remove", ...(o.force ? ["--force"] : []), "--", rec.path])
    } else {
      // Removed by hand: tell git it has gone.
      await git(rec.repo, ["worktree", "prune"]).catch(() => undefined)
    }
    await this.#save(list.filter((w) => w !== rec))
    return rec
  }
}

const samePath = (a: string, b: string) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** Bytes in a folder, walking it without following links, git's own entry left out. */
function folderBytes(dir: string): number {
  let total = 0
  const walk = (d: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink() || (d === dir && e.name === ".git")) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile())
        try {
          total += fs.statSync(p).size
        } catch {
          // gone while reading
        }
    }
  }
  walk(dir)
  return total
}

/** GET /api/worktrees and POST /api/worktrees/remove: the cleanup panel. Each removal is recorded first. */
export function registerWorktreeRoutes(
  app: FastifyInstance,
  ctx: { worktrees?: Worktrees; audit: HostAudit; openIn?: (folder: string) => boolean },
): void {
  app.get("/api/worktrees", async (_req, reply) => {
    if (!ctx.worktrees) return reply.code(404).send({ error: "Worktrees are not available here." })
    const list = await ctx.worktrees.list()
    return { worktrees: list.map((w) => ({ ...w, open: ctx.openIn?.(w.path) ?? false })) }
  })
  app.post("/api/worktrees/remove", async (req, reply) => {
    if (!ctx.worktrees) return reply.code(404).send({ error: "Worktrees are not available here." })
    const b = (req.body ?? {}) as { path?: unknown; force?: unknown }
    if (typeof b.path !== "string" || b.path.length > 4096)
      return reply.code(422).send({ error: "Say which worktree." })
    if (ctx.openIn?.(b.path))
      return reply.code(409).send({ error: "A session is working there. Close it first." })
    const recorded = await ctx.audit.record({
      session: "desktop",
      event: "worktree_removed",
      channel: "desktop",
      tool: "git",
      cwd: "",
      input: { path: b.path, force: b.force === true },
      verdict: {
        outcome: "allow",
        ruleId: "worktree-removed",
        reason: "A worktree Codehouse made was removed from the desktop. Its branch was kept.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    if (!recorded)
      return reply.code(503).send({ error: "It could not be recorded, so it was not removed." })
    try {
      const gone = await ctx.worktrees.remove(b.path, { force: b.force === true })
      return { removed: gone.path, branch: gone.branch }
    } catch (e) {
      return reply
        .code(e instanceof WorktreeError ? 409 : 500)
        .send({ error: (e as Error).message })
    }
  })
}
