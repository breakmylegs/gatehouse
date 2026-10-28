import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import type { AdminContext } from "./api.js"

/**
 * Files for the workspace: list a session's folder, read a file, preview a page, and reveal a file in Explorer.
 * Everything stays inside the session's own folder (real paths, so a junction cannot lead out), and anything the
 * policy floor would refuse to read (secrets, keys) is shown as blocked, never opened. Nothing here writes a file.
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

const bad = (reply: FastifyReply, status: number, error: string) =>
  reply.code(status).header("cache-control", "no-store").send({ error })

export interface FilesDeps {
  /** The working folder of a running session. */
  sessionCwd?: (sessionId: string) => string | undefined
  /** Opens Explorer with the file selected. Injected so tests never open a window. */
  reveal?: (absPath: string) => void
}

export const revealInExplorer = (abs: string): void => {
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

export function registerFilesRoutes(app: FastifyInstance, ctx: AdminContext & FilesDeps): void {
  // Preview addresses: /preview/<token>/<path>. A token belongs to one session folder and lasts while JCVC runs.
  const previews = new Map<string, string>()

  const rootOf = (q: Record<string, unknown>): string | undefined =>
    typeof q.session === "string" ? ctx.sessionCwd?.(q.session) : undefined

  /** The floor decides what may be shown: a secrets file is never opened, even on your own screen. */
  const blocked = async (abs: string, cwd: string): Promise<string | undefined> => {
    const v = await ctx.engine.evaluate({ toolName: "Read", input: { file_path: abs } }, { cwd })
    return v.outcome === "deny" ? v.reason : undefined
  }

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
    const where = insideRoot(root, typeof q.path === "string" ? q.path : "")
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    const st = fs.statSync(where.abs)
    if (st.isDirectory()) return bad(reply, 400, "That is a folder.")
    const why = await blocked(where.abs, root)
    if (why) return { kind: "blocked", reason: why, size: st.size }
    const buf = fs.readFileSync(where.abs, { flag: "r" }).subarray(0, MAX_TEXT)
    // Text if it decodes cleanly and has no NUL bytes.
    const text = buf.toString("utf8")
    if (buf.includes(0) || text.includes(String.fromCharCode(0xfffd))) return { kind: "binary", size: st.size }
    return { kind: "text", text, size: st.size, truncated: st.size > MAX_TEXT }
  })

  app.post("/api/files/preview", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return bad(reply, 404, "That session is not running.")
    for (const [t, r] of previews) if (r === root) return { base: `/preview/${t}/` }
    const token = randomBytes(24).toString("base64url")
    previews.set(token, root)
    return { base: `/preview/${token}/` }
  })

  app.post("/api/files/reveal", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const root = rootOf(b)
    if (!root) return bad(reply, 404, "That session is not running.")
    const where = insideRoot(root, typeof b.path === "string" ? b.path : "")
    if (!where.abs) return bad(reply, 403, where.error ?? "Not allowed.")
    ;(ctx.reveal ?? revealInExplorer)(where.abs)
    return { ok: true }
  })

  // The preview itself. Outside /api, so a frame can load it, but only with a preview token, only inside that
  // folder, never a file the floor blocks, and always sandboxed by the response's own policy.
  app.get("/preview/:token/*", async (req, reply) => {
    const { token } = req.params as { token: string }
    const rest = (req.params as Record<string, string>)["*"] ?? ""
    const root = previews.get(token)
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
