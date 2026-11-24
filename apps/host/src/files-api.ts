import { drift, makeManifest, saveManifest } from "./env-manifest.js"
import { checkTour, readTours } from "./tours.js"
import { curriculum, starterTasks, type OnboardingProgress } from "./onboarding.js"
import { glossary } from "./glossary.js"
import { listFiles as listProjectFiles } from "./mutation.js"
import { detectRunners, discover, TestRunError } from "./test-explorer.js"
import type { LspOp } from "./lsp-client.js"
import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import { compileGlobs, redactString, secretGlobs } from "@gatehouse/policy"
import { gatehouseDataDir } from "@gatehouse/shared/node"
import { CodeIndex } from "./code-index.js"
import { reviewDiff, reviewerRuntime, sessionDiff, type Finding } from "./review.js"
import type { LocalRuntimeConfig } from "./providers/local-runtime.js"
import { createCheckpoint, writeFileAtomic } from "@gatehouse/shared/node"
import type { AdminContext } from "./api.js"
import { languageOf, outline } from "./outline.js"
import { TsService, type TsOp } from "./ts-service.js"
import { TestLocks } from "./test-locks.js"
import { whyLine } from "./why.js"
import {
  applyReplace,
  previewReplace,
  readerFor,
  SearchError,
  searchFiles,
  type SearchOptions,
} from "./file-search.js"

/**
 * Files for the workspace: list a session's folder, read a file, preview a page, and reveal a file in Explorer.
 * Everything stays inside the session's own folder (real paths, so a junction cannot lead out), except a file the
 * session itself wrote or edited elsewhere, which can be read, copied out or shown in Explorer (owner, 4 Nov). Anything
 * the policy floor would refuse to read (secrets, keys) is shown as blocked, never opened. The two things here that
 * write are your own: Replace (G35), shown first, after a checkpoint; and Save (G33), only over the version you
 * opened. Both are recorded and never touch a blocked file.
 */

const MAX_TEXT = 1024 * 1024
const MAX_ENTRIES = 1000

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex")

const bad = (reply: FastifyReply, status: number, error: string) =>
  reply.code(status).header("cache-control", "no-store").send({ error })

export interface FilesDeps {
  /** The working folder of a running session. */
  sessionCwd?: (sessionId: string) => string | undefined
  /** E-075: onboarding progress, per project. */
  onboarding?: OnboardingProgress
  /** Whether the session wrote or edited the file at this full path (it may be outside its folder). */
  sessionWrote?: (sessionId: string, absPath: string) => boolean
  /** Opens Explorer with the file selected. Injected so tests never open a window. */
  reveal?: (absPath: string) => void
  /** T-116: opens an editor's own link. Injected so tests never open one. */
  openLink?: (link: string) => void
}

/** T-116: an editor's link to a file at a line: vscode://file/C:/dev/x.ts:12 (Cursor's is cursor://). */
export function editorLink(editor: "vscode" | "cursor", abs: string, line?: number): string {
  const p = abs.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/").replace(/^([A-Za-z])%3A/, "$1:")
  return `${editor}://file/${p.replace(/^\/+/, "")}${line ? `:${line}` : ""}`
}

/** Opens a link with what Windows (or macOS) has for it, without a shell: the link is one argument. */
export const openLink = (link: string): void => {
  if (!/^(vscode|cursor):\/\/file\//.test(link)) return
  if (process.platform === "darwin") {
    spawn("/usr/bin/open", [link], { detached: true, stdio: "ignore" }).unref()
    return
  }
  if (process.platform !== "win32") return
  spawn("explorer.exe", [link], { detached: true, stdio: "ignore", windowsHide: false }).unref()
}

export const revealInExplorer = (abs: string): void => {
  // Mac fork: on a Mac, Finder with the file selected. The path is absolute, so open never reads it as an option.
  if (process.platform === "darwin" && path.isAbsolute(abs)) {
    spawn("/usr/bin/open", ["-R", abs], { detached: true, stdio: "ignore" }).unref()
    return
  }
  if (process.platform !== "win32") return
  spawn("explorer.exe", [`/select,${abs}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  }).unref()
}

function real(p: string): string {
  return fs.realpathSync.native(p)
}

/** The real path of a file inside the root, or an error saying why not. */
export function insideRoot(root: string, rel: string): { abs?: string; error?: string } {
  if (rel.includes("\0")) return { error: "That is not a file name." }
  let rootReal: string
  try {
    rootReal = real(root)
  } catch {
    return { error: "The session folder is not there." }
  }
  const target = path.resolve(rootReal, rel || ".")
  let targetReal: string
  try {
    targetReal = real(target)
  } catch {
    return { error: "That file is not there." }
  }
  const a = targetReal.toLowerCase()
  const b = rootReal.toLowerCase()
  if (a !== b && !a.startsWith(b.endsWith(path.sep) ? b : b + path.sep))
    return { error: "That is outside the session folder." }
  return { abs: targetReal }
}

/** Folders never searched for @: version control, dependencies and build output. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".turbo",
  ".venv",
  "__pycache__",
  "target",
  "bin",
  "obj",
])
/** The most entries one search looks at, how deep it goes, and how many it returns. */
const FIND_VISIT = 20_000
const FIND_DEPTH = 12
const FIND_MAX = 20

/**
 * Files under `root` (relative, forward slashes) whose name or path holds `query`, ignoring case: a name starting with
 * it first, then a name holding it, then a path holding it, shorter paths first. Links and junctions are never followed,
 * and the walk stops after FIND_VISIT entries. An empty query gives the files nearest the top.
 */
export function findFiles(root: string, query: string): string[] {
  const q = query.toLowerCase().replace(/\\/g, "/")
  const hits: Array<{ rel: string; rank: number }> = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length && visited < FIND_VISIT) {
    const { dir, depth } = queue.shift()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of entries) {
      if (++visited > FIND_VISIT) break
      const full = path.join(dir, d.name)
      if (d.isSymbolicLink()) continue
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name) && depth < FIND_DEPTH)
          queue.push({ dir: full, depth: depth + 1 })
        continue
      }
      if (!d.isFile()) continue
      const rel = path.relative(root, full).split(path.sep).join("/")
      const name = d.name.toLowerCase()
      const rank = !q
        ? 3
        : name.startsWith(q)
          ? 0
          : name.includes(q)
            ? 1
            : rel.toLowerCase().includes(q)
              ? 2
              : -1
      if (rank >= 0) hits.push({ rel, rank })
    }
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))
    .slice(0, FIND_MAX)
    .map((h) => h.rel)
}

export function registerFilesRoutes(app: FastifyInstance, ctx: AdminContext & FilesDeps): void {
  // G38: the test explorer, its tests read from the session's folder and run with the project's own runner.
  app.get("/api/tests", async (req, reply) => {
    const root = rootOf(req.query as Record<string, unknown>)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    try {
      const r = real(root)
      const files = await listProjectFiles(r).catch(() => [] as string[])
      return { runners: detectRunners(r, files), files: discover(r, files) }
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })
  app.post("/api/tests/run", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    if (!ctx.tests) return reply.code(503).send({ error: "The test explorer is not available here." })
    const runner = b.runner
    if (runner !== "vitest" && runner !== "jest" && runner !== "pytest" && runner !== "dotnet") return reply.code(422).send({ error: "Choose a runner." })
    const file = typeof b.file === "string" && b.file ? b.file : undefined
    const name = typeof b.name === "string" && b.name ? b.name.slice(0, 500) : undefined
    try {
      const r = real(root)
      if (file && !insideRoot(r, file).abs) return reply.code(422).send({ error: "That file is not in the project." })
      const files = discover(r, await listProjectFiles(r).catch(() => [] as string[]))
      return await ctx.tests.run(b.session as string, r, runner, { ...(file ? { file } : {}), ...(name ? { name } : {}) }, files)
    } catch (e) {
      return reply.code(e instanceof TestRunError ? 409 : 500).send({ error: (e as Error).message })
    }
  })

  // C-032: one TypeScript language service for this Host, started at its first question, closed with the Host.
  let tsService: TsService | undefined
  const ts = { ask: (op: TsOp, root: string, file: string, pos: number) => (tsService ??= new TsService()).ask(op, root, file, pos) }
  app.addHook("onClose", async () => {
    await tsService?.close()
    ctx.languageServers?.close()
  })
  // Preview addresses: /preview/<token>/<path>. A token belongs to one session and its folder, and ends when that
  // session closes or no longer works there (backlog O13: they used to last while Codehouse ran).
  const previews = new Map<string, { root: string; session: string }>()
  const liveRoot = (token: string): string | undefined => {
    const p = previews.get(token)
    if (!p) return undefined
    if (ctx.sessionCwd?.(p.session) === p.root) return p.root
    previews.delete(token)
    return undefined
  }

  const rootOf = (q: Record<string, unknown>): string | undefined =>
    typeof q.session === "string" ? ctx.sessionCwd?.(q.session) : undefined

  /**
   * A file the request names: inside the session's folder, or, given as a full path, one the session itself wrote or
   * edited (owner, 4 Nov: a file Claude made elsewhere opened only in Explorer). Anything else outside is refused.
   */
  const locate = (q: Record<string, unknown>, root: string): { abs?: string; error?: string } => {
    const given = typeof q.path === "string" ? q.path : ""
    const inside = insideRoot(root, given)
    if (inside.abs || !path.isAbsolute(given) || typeof q.session !== "string") return inside
    let abs: string
    try {
      abs = real(given)
    } catch {
      return { error: "That file is not there." }
    }
    const wrote = ctx.sessionWrote
    return wrote && (wrote(q.session, abs) || wrote(q.session, path.resolve(given)))
      ? { abs }
      : inside
  }

  /** The floor decides what may be shown: a secrets file is never opened, even on your own screen. */
  const blocked = async (abs: string, cwd: string): Promise<string | undefined> => {
    const v = await ctx.engine.evaluate({ toolName: "Read", input: { file_path: abs } }, { cwd })
    return v.outcome === "deny" ? v.reason : undefined
  }

  // C-036: the session's project, indexed under the data folder (text and symbols), brought up to date at most once a
  // minute when asked. Never built without the policy: the floor's secret globs decide what it may hold.
  const indexes = new Map<string, CodeIndex>()
  app.addHook("onClose", async () => {
    for (const i of indexes.values()) i.close()
    indexes.clear()
  })
  const indexFor = async (root: string, fresh: boolean): Promise<CodeIndex> => {
    const policy = ctx.store.current
    if (!policy) throw new SearchError("No policy is loaded, so nothing is indexed: the floor decides what an index may hold.")
    const blocked = compileGlobs(secretGlobs(policy))
    let i = indexes.get(root)
    if (!i) {
      i = new CodeIndex({ dir: path.join(gatehouseDataDir(ctx.env), "code-index"), root, blocked: (abs) => blocked(abs) })
      indexes.set(root, i)
    }
    if (fresh || Date.now() - i.lastRefresh > 60_000) await i.refresh()
    return i
  }
  app.get("/api/index/search", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    try {
      return { results: (await indexFor(real(root), false)).search(String(q.q ?? ""), Number(q.limit ?? 50)) }
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })
  app.get("/api/index/symbols", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    try {
      return { symbols: (await indexFor(real(root), false)).symbols(String(q.q ?? ""), Number(q.limit ?? 50)) }
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })
  app.post("/api/index/refresh", async (req, reply) => {
    const root = rootOf((req.body ?? {}) as Record<string, unknown>)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    try {
      // A stale index is brought up to date by indexFor; refreshing again then reads only what changed since.
      return { stats: await (await indexFor(real(root), false)).refresh() }
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })

  // E-025: the tools this computer has against what the project asks for, kept in .codehouse/environment.json with
  // environment variables by name only; drift said plainly.
  app.post("/api/environment", async (req, reply) => {
    const root = rootOf((req.body ?? {}) as Record<string, unknown>)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    const manifest = await makeManifest(real(root))
    await saveManifest(real(root), manifest)
    return { manifest, drift: drift(manifest) }
  })

  // D-079: the project's tours, each step checked against the index: where its symbol is now, or moved, or gone.
  app.get("/api/tours", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    try {
      const index = await indexFor(real(root), false)
      const { tours, errors } = readTours(real(root))
      return { tours: tours.map((t) => ({ name: t.name, title: t.title, steps: checkTour(t, (n) => index.symbols(n, 50)) })), errors }
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })

  // E-075: the project's onboarding path (tours, terms, drills, starter tasks), each step linked, with your progress.
  app.get("/api/onboarding", async (req, reply) => {
    const root = rootOf(req.query as Record<string, unknown>)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    try {
      const r = real(root)
      const index = await indexFor(r, false)
      const tours = readTours(r).tours.map((t) => ({ tour: t, steps: checkTour(t, (n) => index.symbols(n, 50)) }))
      const terms = glossary(r, await listProjectFiles(r).catch(() => [] as string[])).terms
      const steps = curriculum({ tours, terms, starter: starterTasks(r), exists: (f) => fs.existsSync(path.join(r, f)) })
      return { project: path.basename(r), steps, done: ctx.onboarding?.done(path.basename(r)) ?? {} }
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })
  app.post("/api/onboarding/progress", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    if (typeof b.step !== "string" || !b.step || b.step.length > 120 || typeof b.done !== "boolean") return reply.code(400).send({ error: "Name the step, and whether it is done." })
    if (!ctx.onboarding) return reply.code(409).send({ error: "Onboarding progress is not kept here." })
    const project = path.basename(real(root))
    await ctx.onboarding.mark(project, b.step, b.done)
    return { done: ctx.onboarding.done(project) }
  })

  // C-043: a second model reviews the session's change, through the runtime or gateway on this computer; the last
  // review of each session is kept while Codehouse runs, for the Review pane.
  const reviews = new Map<string, { at: string; findings: Finding[]; truncated: boolean; model: string }>()
  app.get("/api/review", async (req) => {
    const s = (req.query as { session?: unknown }).session
    const p = ctx.config().providers
    return { review: typeof s === "string" ? (reviews.get(s) ?? null) : null, available: Boolean(reviewerRuntime(p?.local as LocalRuntimeConfig | undefined, p?.reviewer?.model)) }
  })
  app.post("/api/review", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return reply.code(404).send({ error: "That session is not open." })
    const p = ctx.config().providers
    const model = p?.reviewer?.model
    const cfg = reviewerRuntime(p?.local as LocalRuntimeConfig | undefined, model)
    if (!cfg || !model) return reply.code(409).send({ error: "No reviewer is set. Choose a model on your runtime or gateway in Settings, Models." })
    const policy = ctx.store.current
    if (!policy) return reply.code(409).send({ error: "No policy is loaded, so the change is not sent: the floor decides what may leave." })
    try {
      const diff = await sessionDiff(real(root), secretGlobs(policy))
      if (!diff.trim()) return reply.code(409).send({ error: "There is no change since the last commit to review." })
      const r = await reviewDiff({ diff, runtime: { cfg, model }, redact: (t) => redactString(t, { terms: ctx.config().redactTerms }) })
      const kept = { at: new Date().toISOString(), ...r, model }
      reviews.set(String(b.session), kept)
      await ctx.audit.record({
        session: String(b.session),
        event: "review_run",
        channel: "desktop",
        tool: "review",
        input: { model, findings: r.findings.length, truncated: r.truncated },
        verdict: { outcome: "allow", ruleId: "review-run", reason: `A review of the change by ${model}, through the runtime on this computer.`, risk: 0, decidedBy: "human-desktop", policyHash: policy.hash },
        latencyMs: 0,
      })
      return { review: kept }
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message })
    }
  })

  // G35: search the session's files, and replace with the changed lines shown first.
  const searchOf = (b: Record<string, unknown>): SearchOptions => ({
    pattern: typeof b.pattern === "string" ? b.pattern : typeof b.q === "string" ? b.q : "",
    regex: b.regex === true || b.regex === "1",
    caseSensitive: b.caseSensitive === true || b.case === "1",
  })
  const readIn = (root: string) => readerFor(root, insideRoot, (abs) => blocked(abs, root))
  app.get("/api/files/search", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return bad(reply, 404, "That session is not running.")
    try {
      return await searchFiles(real(root), searchOf(q))
    } catch (e) {
      return bad(reply, e instanceof SearchError ? 422 : 500, (e as Error).message)
    }
  })
  app.post("/api/files/replace/preview", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return bad(reply, 404, "That session is not running.")
    const paths = Array.isArray(b.paths)
      ? b.paths.filter((p): p is string => typeof p === "string")
      : []
    const replacement = typeof b.replacement === "string" ? b.replacement : ""
    try {
      return await previewReplace(paths, searchOf(b), replacement, readIn(real(root)))
    } catch (e) {
      return bad(reply, e instanceof SearchError ? 422 : 500, (e as Error).message)
    }
  })
  app.post("/api/files/replace", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return bad(reply, 404, "That session is not running.")
    const shown = (Array.isArray(b.files) ? b.files : []).filter(
      (f): f is { path: string; hash: string } =>
        typeof (f as { path?: unknown })?.path === "string" &&
        typeof (f as { hash?: unknown })?.hash === "string",
    )
    if (!shown.length) return bad(reply, 422, "Look at what would change before replacing.")
    const replacement = typeof b.replacement === "string" ? b.replacement : ""
    const o = searchOf(b)
    const policy = ctx.store.current
    if (!policy)
      return bad(
        reply,
        503,
        "No policy is loaded, so secrets could not be kept out of the undo point.",
      )
    // A checkpoint first, so Undo in Changes puts every file back; without one, nothing is changed.
    let ref: string
    try {
      ref = (
        await createCheckpoint({
          cwd: root,
          sessionId: String(b.session),
          label: `before replacing in ${shown.length === 1 ? "1 file" : `${shown.length} files`}`,
          excludeGlobs: secretGlobs(policy),
        })
      ).ref
    } catch {
      return bad(
        reply,
        409,
        "Replace needs the folder to be in git, so the change can be undone. Nothing was changed.",
      )
    }
    const recorded = await ctx.audit.record({
      session: String(b.session),
      event: "files_replaced",
      channel: "desktop",
      tool: "replace",
      cwd: root,
      input: {
        files: shown.length,
        patternChars: o.pattern.length,
        regex: o.regex === true,
        checkpoint: ref,
      },
      verdict: {
        outcome: "allow",
        ruleId: "files-replaced",
        reason:
          "You replaced text across files from the desktop, after the changes were shown. A checkpoint was saved first.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: policy.hash,
      },
      latencyMs: 0,
    })
    if (!recorded) return bad(reply, 503, "It could not be recorded, so nothing was changed.")
    try {
      const done = await applyReplace(shown, o, replacement, readIn(real(root)), writeFileAtomic)
      return { ...done, checkpoint: ref }
    } catch (e) {
      return bad(reply, e instanceof SearchError ? 422 : 500, (e as Error).message)
    }
  })

  // F15 (backlog): files in the session's folder whose name or path holds what you typed after @, for the prompt box.
  app.get("/api/files/find", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return bad(reply, 404, "That session is not running.")
    const query = typeof q.q === "string" ? q.q.slice(0, 200) : ""
    return { files: findFiles(real(root), query) }
  })

  app.get("/api/files/list", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return bad(reply, 404, "That session is not running.")
    const dir = typeof q.dir === "string" ? q.dir : ""
    const where = insideRoot(root, dir)
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    let names: fs.Dirent[]
    try {
      names = fs.readdirSync(where.abs, { withFileTypes: true })
    } catch {
      return bad(reply, 404, "That folder cannot be read.")
    }
    const rootReal = real(root)
    const entries = names
      .filter((d) => d.name !== ".git")
      .map((d) => {
        const full = path.join(where.abs as string, d.name)
        let size = 0
        let mtime = ""
        try {
          const st = fs.statSync(full)
          size = st.size
          mtime = st.mtime.toISOString()
        } catch {
          // A file that vanished while listing is shown without size.
        }
        return {
          name: d.name,
          rel: path.relative(rootReal, full).split(path.sep).join("/"),
          kind: d.isDirectory() ? ("dir" as const) : ("file" as const),
          size,
          mtime,
        }
      })
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
      )
    return {
      root: rootReal,
      dir: path.relative(rootReal, where.abs).split(path.sep).join("/"),
      entries: entries.slice(0, MAX_ENTRIES),
      more: Math.max(0, entries.length - MAX_ENTRIES),
    }
  })

  app.get("/api/files/read", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return bad(reply, 404, "That session is not running.")
    const where = locate(q, root)
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    const st = fs.statSync(where.abs)
    if (st.isDirectory()) return bad(reply, 400, "That is a folder.")
    const why = await blocked(where.abs, root)
    if (why) return { kind: "blocked", reason: why, size: st.size }
    const buf = fs.readFileSync(where.abs, { flag: "r" }).subarray(0, MAX_TEXT)
    // Text if it decodes cleanly and has no NUL bytes.
    const text = buf.toString("utf8")
    if (buf.includes(0) || text.includes(String.fromCharCode(0xfffd)))
      return { kind: "binary", size: st.size }
    return {
      kind: "text",
      text,
      size: st.size,
      truncated: st.size > MAX_TEXT,
      // G33: what the file was when shown, so a save can tell if it changed outside since.
      hash: sha256(fs.readFileSync(where.abs)),
    }
  })

  // C-031: a file's outline (its functions, classes, methods, types, test cases, JSON keys) with their lines, for the
  // file view and go to symbol. The same checks as reading it.
  app.get("/api/files/outline", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return bad(reply, 404, "That session is not running.")
    const where = locate(q, root)
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    const lang = languageOf(where.abs)
    if (!lang) return { symbols: [], language: null }
    const st = fs.statSync(where.abs)
    if (!st.isFile() || st.size > MAX_TEXT) return { symbols: [], language: lang }
    if (await blocked(where.abs, root)) return { symbols: [], language: lang }
    const symbols = await outline(fs.readFileSync(where.abs, "utf8"), lang).catch(() => [])
    return { symbols, language: lang }
  })

  // C-032: TypeScript's language service for a .ts, .tsx, .js or .jsx file in the session's folder: diagnostics, what
  // the name at a position is, its definition and its references. The same checks as reading the file; results outside
  // the session's folder are left out, and paths are given from it.
  app.get("/api/files/ts", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return bad(reply, 404, "That session is not running.")
    const where = locate(q, root)
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    const op = String(q.op ?? "")
    if (!["diagnostics", "info", "definition", "references"].includes(op)) return bad(reply, 422, "Diagnostics, info, definition or references.")
    if (!/\.(m|c)?(t|j)sx?$/i.test(where.abs)) return bad(reply, 422, "Only TypeScript and JavaScript files.")
    if (!fs.existsSync(where.abs) || !fs.statSync(where.abs).isFile() || fs.statSync(where.abs).size > MAX_TEXT) return bad(reply, 422, "That file cannot be read here.")
    if (await blocked(where.abs, root)) return bad(reply, 403, "The floor blocks that file.")
    const pos = Math.max(0, Math.min(Number(q.pos) || 0, MAX_TEXT))
    try {
      const result = await ts.ask(op as TsOp, path.resolve(root), path.resolve(where.abs), pos)
      // Only what is inside the session's folder, with paths from it.
      const inside = (r: { file?: string }) => !r.file || path.resolve(r.file).startsWith(path.resolve(root) + path.sep)
      const rel = <T extends { file?: string }>(r: T): T => (r.file ? { ...r, file: path.relative(root, r.file).split(path.sep).join("/") } : r)
      if (Array.isArray(result)) return { op, results: (result as Array<{ file?: string }>).filter(inside).map(rel) }
      return { op, result }
    } catch (e) {
      return bad(reply, 503, (e as Error).message)
    }
  })

  // G34: a language server you named, for a file of its kind; the same answers as the TypeScript route.
  app.get("/api/files/lsp", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return bad(reply, 404, "That session is not running.")
    const where = locate(q, root)
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    // No server named for this kind of file: the window shows nothing for it.
    if (!ctx.languageServers?.has(where.abs)) return reply.code(404).send({ error: "No language server is named for this kind of file.", none: true })
    const op = String(q.op ?? "")
    if (!["diagnostics", "info", "definition", "references"].includes(op)) return bad(reply, 422, "Diagnostics, info, definition or references.")
    if (!fs.existsSync(where.abs) || !fs.statSync(where.abs).isFile() || fs.statSync(where.abs).size > MAX_TEXT) return bad(reply, 422, "That file cannot be read here.")
    if (await blocked(where.abs, root)) return bad(reply, 403, "The floor blocks that file.")
    const pos = Math.max(0, Math.min(Number(q.pos) || 0, MAX_TEXT))
    try {
      const result = await ctx.languageServers.ask(op as LspOp, path.resolve(root), path.resolve(where.abs), pos)
      if (Array.isArray(result)) return { op, results: result }
      return { op, result }
    } catch (e) {
      return bad(reply, 503, (e as Error).message)
    }
  })

  // G37: the debugger, for the window: the adapters named, the state, and each action as yours.
  app.get("/api/debug", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    if (!rootOf(q)) return reply.code(404).send({ error: "That session is not open." })
    return { adapters: (ctx.config().debugAdapters ?? []).map((a) => ({ name: a.name, kind: a.kind })), state: ctx.debugger?.state(String(q.session)) ?? null }
  })
  app.post("/api/debug/:action", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root || !ctx.debugger) return reply.code(404).send({ error: "That session is not open." })
    const id = String(b.session)
    const action = (req.params as { action: string }).action
    try {
      if (action === "start") {
        const bps = (b.breakpoints && typeof b.breakpoints === "object" ? b.breakpoints : {}) as Record<string, unknown>
        const breakpoints = Object.fromEntries(Object.entries(bps).map(([f, l]) => [f, Array.isArray(l) ? l.map(Number) : []]))
        const args = Array.isArray(b.args) ? b.args.map(String) : []
        await ctx.debugger.start(id, real(root), "desktop", { adapter: String(b.adapter ?? ""), program: String(b.program ?? ""), args, breakpoints })
      } else if (action === "breakpoints") await ctx.debugger.setBreakpoints(id, "desktop", String(b.file ?? ""), Array.isArray(b.lines) ? b.lines.map(Number) : [])
      else if (["continue", "next", "stepIn", "stepOut", "pause"].includes(action)) await ctx.debugger.step(id, "desktop", action as "continue")
      else if (action === "stop") await ctx.debugger.stop(id, "desktop")
      else return reply.code(404).send({ error: "No such debugger action." })
      return { state: action === "stop" ? null : await ctx.debugger.settle(id, action === "pause" ? 2000 : 10_000) }
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })

  // D-081: why a line is like this: its last commit, that commit's Codehouse note, and the decisions that bear on it.
  app.get("/api/files/why", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const root = rootOf(q)
    if (!root) return bad(reply, 404, "That session is not running.")
    const where = locate(q, root)
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    if (await blocked(where.abs, root)) return bad(reply, 403, "The floor blocks that file.")
    const line = Math.floor(Number(q.line))
    if (!Number.isFinite(line) || line < 1 || line > 1_000_000) return bad(reply, 422, "Give a line number.")
    const repo = TestLocks.rootOf(root)
    return await whyLine(repo, path.relative(repo, where.abs).split(path.sep).join("/"), line)
  })

  // G33: your own edit to a file in the session's folder, saved only if the file is still as it was when you opened
  // it, never to a file the floor blocks, never past 1 MB, and recorded (where and how big, never the text).
  app.post("/api/files/save", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return bad(reply, 404, "That session is not running.")
    if (typeof b.text !== "string" || typeof b.hash !== "string")
      return bad(reply, 422, "Say what to save, and which version you edited.")
    if (Buffer.byteLength(b.text) > MAX_TEXT)
      return bad(reply, 413, "Files over 1 MB are not edited here.")
    const where = insideRoot(root, typeof b.path === "string" ? b.path : "")
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    if (!fs.statSync(where.abs).isFile()) return bad(reply, 400, "That is not a file.")
    const why =
      (await blocked(where.abs, root)) ??
      (await ctx.engine
        .evaluate({ toolName: "Edit", input: { file_path: where.abs } }, { cwd: root })
        .then((v) => (v.outcome === "deny" && v.decidedBy === "floor" ? v.reason : undefined)))
    if (why) return bad(reply, 403, `That file is blocked by the policy: ${why}`)
    if (sha256(fs.readFileSync(where.abs)) !== b.hash)
      return bad(
        reply,
        409,
        "The file changed outside since you opened it, so it was not saved. Copy your text, then reload it.",
      )
    const recorded = await ctx.audit.record({
      session: String(b.session),
      event: "file_saved",
      channel: "desktop",
      tool: "Edit",
      cwd: root,
      input: { path: where.abs, bytes: Buffer.byteLength(b.text) },
      verdict: {
        outcome: "allow",
        ruleId: "file-saved",
        reason: "You edited and saved a file in the session's folder from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
    if (!recorded) return bad(reply, 503, "It could not be recorded, so it was not saved.")
    await writeFileAtomic(where.abs, b.text)
    return { saved: true, hash: sha256(Buffer.from(b.text, "utf8")) }
  })

  app.post("/api/files/preview", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return bad(reply, 404, "That session is not running.")
    const session = String(b.session)
    for (const [t, p] of previews)
      if (p.root === root && p.session === session) return { base: `/preview/${t}/` }
    const token = randomBytes(24).toString("base64url")
    previews.set(token, { root, session })
    return { base: `/preview/${token}/` }
  })

  // Save a copy of a session's file wherever you choose (owner, 3 Nov). You choose the place in the Windows save
  // window; a file the floor blocks is never copied, and nothing is copied that could not be recorded first.
  app.post("/api/files/save-copy", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return bad(reply, 404, "That session is not running.")
    const where = locate(b, root)
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    if (fs.statSync(where.abs).isDirectory()) return bad(reply, 400, "That is a folder.")
    const why = await blocked(where.abs, root)
    if (why) return bad(reply, 403, why)
    if (!ctx.saveAs) return bad(reply, 501, "Saving a copy in a window is not available here.")
    const to = await ctx.saveAs(path.basename(where.abs))
    if (!to) return { saved: null }
    const recorded = await ctx.audit.record({
      session: typeof b.session === "string" ? b.session : "desktop",
      event: "file_copied_out",
      channel: "desktop",
      tool: "files",
      cwd: root,
      input: { path: path.relative(root, where.abs), to },
      verdict: {
        outcome: "allow",
        ruleId: "file-copied-out",
        reason: "You saved a copy of a session's file from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })
    if (!recorded) return bad(reply, 503, "It could not be recorded, so no copy was saved.")
    fs.copyFileSync(where.abs, to)
    return { saved: to }
  })

  app.post("/api/files/reveal", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return bad(reply, 404, "That session is not running.")
    const where = locate(b, root)
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    ;(ctx.reveal ?? revealInExplorer)(where.abs)
    return { ok: true }
  })

  // T-116: a file in your own editor, at a line. Only a file of the session's (as reveal allows), never one the floor
  // blocks (a secret would open in plain view), through the editor's own link so no shell is ever run.
  app.post("/api/files/open-editor", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return bad(reply, 404, "That session is not running.")
    const where = locate(b, root)
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    if (await blocked(where.abs, root)) return bad(reply, 403, "That file is blocked by the policy, so it is not opened.")
    const editor = b.editor === "cursor" ? "cursor" : "vscode"
    const line = typeof b.line === "number" && Number.isInteger(b.line) && b.line > 0 && b.line < 10_000_000 ? b.line : undefined
    ;(ctx.openLink ?? openLink)(editorLink(editor, where.abs, line))
    return { ok: true }
  })

  // The preview itself. Outside /api, so a frame can load it, but only with a preview token, only inside that
  // folder, never a file the floor blocks, and always sandboxed by the response's own policy.
  app.get("/preview/:token/*", async (req, reply) => {
    const { token } = req.params as { token: string }
    const rest = (req.params as Record<string, string>)["*"] ?? ""
    const root = liveRoot(token)
    if (!root) return bad(reply, 404, "This preview has ended.")
    let rel: string
    try {
      rel = decodeURIComponent(rest)
    } catch {
      return bad(reply, 400, "That is not a file name.")
    }
    const where = insideRoot(root, rel || "index.html")
    if (!where.abs) return bad(reply, 404, where.error ?? "Not found.")
    let abs = where.abs
    if (fs.statSync(abs).isDirectory()) abs = path.join(abs, "index.html")
    if (!fs.existsSync(abs)) return bad(reply, 404, "Not found.")
    if (await blocked(abs, root)) return bad(reply, 403, "That file is blocked by the policy.")
    return reply
      .header("content-type", TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream")
      .header(
        "content-security-policy",
        "sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:",
      )
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "no-store")
      .send(fs.readFileSync(abs))
  })
}
