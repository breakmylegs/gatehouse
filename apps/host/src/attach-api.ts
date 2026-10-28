import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import type { AdminContext } from "./api.js"
import { insideRoot } from "./files-api.js"

/**
 * Attachments for the composer. A file inside the session folder is mentioned where it is. A file from elsewhere,
 * or a picture pasted or dropped into the composer, is copied into the session folder under .jcvc/attachments so
 * Claude can read it without leaving the folder. A file the policy floor would refuse to read (secrets, keys) is
 * never copied. Every copy is recorded in the audit log by name.
 */
const MAX_ATTACH = 20 * 1024 * 1024
const PICTURE = /^image\/(png|jpeg|gif|webp)$/

const bad = (reply: FastifyReply, status: number, error: string) =>
  reply.code(status).header("cache-control", "no-store").send({ error })

export type FilePicker = () => Promise<string[]>

/** The Windows file window, several files at once. The script is fixed; nothing from the request reaches it. */
export const pickFilesWithWindows: FilePicker = () =>
  new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("Choosing files in a window is only available on Windows."))
      return
    }
    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; $f.ShowInTaskbar = $false",
      "$f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point(-2000, -2000); $f.Show()",
      "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect = $true; $d.Title = 'Add files or photos'",
      'if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write(($d.FileNames -join "`n")) }',
      "$f.Close()",
    ].join("; ")
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    )
    const chunks: Buffer[] = []
    child.stdout.on("data", (c: Buffer) => chunks.push(c))
    child.on("error", reject)
    child.on("exit", () =>
      resolve(
        Buffer.concat(chunks)
          .toString("utf8")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    )
  })

function safeName(name: string): string {
  const base =
    path
      .basename(name)
      .replace(/[^A-Za-z0-9._ -]/g, "_")
      .slice(0, 80) || "file"
  return `${randomBytes(3).toString("hex")}-${base}`
}

export function registerAttachRoutes(
  app: FastifyInstance,
  ctx: AdminContext & { sessionCwd?: (id: string) => string | undefined; pickFiles?: FilePicker },
): void {
  const rootOf = (id: unknown) => (typeof id === "string" ? ctx.sessionCwd?.(id) : undefined)
  const blocked = async (abs: string, cwd: string) =>
    (await ctx.engine.evaluate({ toolName: "Read", input: { file_path: abs } }, { cwd }))
      .outcome === "deny"
  const audit = (session: string, cwd: string, names: string[]) =>
    ctx.audit.record({
      session,
      event: "files_attached",
      channel: "desktop",
      tool: "attach",
      cwd,
      input: { names },
      verdict: {
        outcome: "allow",
        ruleId: "files-attached",
        reason: "Files were attached to a prompt from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: ctx.store.current?.hash ?? "",
      },
      latencyMs: 0,
    })

  /** Copies one file into the attachments folder and returns its path relative to the session folder. */
  const copyIn = (cwd: string, name: string, bytes: Buffer): string => {
    const dir = path.join(cwd, ".jcvc", "attachments")
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, safeName(name))
    fs.writeFileSync(file, bytes)
    return path.relative(cwd, file).split(path.sep).join("/")
  }

  app.post("/api/files/pick-files", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const cwd = rootOf(b.session)
    if (!cwd) return bad(reply, 404, "That session is not running.")
    if (!ctx.pickFiles) return bad(reply, 501, "Choosing files in a window is not available here.")
    try {
      return { paths: await ctx.pickFiles() }
    } catch (e) {
      return bad(reply, 500, (e as Error).message)
    }
  })

  app.post("/api/files/attach", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const cwd = rootOf(b.session)
    if (!cwd) return bad(reply, 404, "That session is not running.")
    const paths = Array.isArray(b.paths)
      ? b.paths.filter((p): p is string => typeof p === "string").slice(0, 20)
      : []
    if (paths.length === 0) return bad(reply, 400, "Give the files to attach.")
    const out: Array<{ path: string; rel?: string; error?: string }> = []
    const copied: string[] = []
    for (const p of paths) {
      if (!path.isAbsolute(p) || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
        out.push({ path: p, error: "That file is not there." })
        continue
      }
      if (await blocked(p, cwd)) {
        out.push({ path: p, error: "That file is blocked by the policy and was not attached." })
        continue
      }
      const inside = insideRoot(cwd, path.relative(cwd, p))
      if (inside.abs) {
        out.push({
          path: p,
          rel: path.relative(fs.realpathSync.native(cwd), inside.abs).split(path.sep).join("/"),
        })
        continue
      }
      if (fs.statSync(p).size > MAX_ATTACH) {
        out.push({ path: p, error: "That file is over 20 MB." })
        continue
      }
      const rel = copyIn(cwd, p, fs.readFileSync(p))
      copied.push(path.basename(p))
      out.push({ path: p, rel })
    }
    if (copied.length) await audit(String(b.session), cwd, copied)
    return { files: out }
  })

  // A picture pasted or dropped into the composer.
  app.post("/api/files/attach-data", { bodyLimit: 30 * 1024 * 1024 }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const cwd = rootOf(b.session)
    if (!cwd) return bad(reply, 404, "That session is not running.")
    const type = typeof b.type === "string" ? b.type : ""
    if (!PICTURE.test(type))
      return bad(reply, 415, "Only png, jpeg, gif and webp pictures can be pasted.")
    const data = typeof b.data === "string" ? Buffer.from(b.data, "base64") : Buffer.alloc(0)
    if (data.length === 0 || data.length > MAX_ATTACH)
      return bad(reply, 413, "The picture is empty or over 20 MB.")
    const ext = type.split("/")[1] === "jpeg" ? "jpg" : type.split("/")[1]
    const name = typeof b.name === "string" && b.name ? b.name : `pasted.${ext}`
    const rel = copyIn(cwd, name, data)
    await audit(String(b.session), cwd, [path.basename(rel)])
    return { rel }
  })
}
