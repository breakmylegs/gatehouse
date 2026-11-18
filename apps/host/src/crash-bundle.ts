/**
 * E-097 (expansion, Wave E1): the crash bundle. One click in Doctor shows what would go in it, and saving writes
 * exactly that, as a zip in Downloads, recorded in the audit log:
 *   host.log            the newest part of the Host's log, redacted (your redaction list and every secret pattern)
 *   version.json        Codehouse's version, Windows or macOS, Node
 *   doctor.txt          the Doctor report, redacted
 *   audit-outcomes.json the last 200 audit records: when, what kind, through which channel, the outcome and its rule;
 *                       never their inputs, folders or reasons
 *   crash-codes.json    the process exit codes the log names, with what they usually mean
 *   settings-keys.json  the names of your settings, never their values
 * Inputs, prompts, transcripts and secrets are never in it.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { redactString } from "@gatehouse/policy"
import { listAuditFiles } from "@gatehouse/shared/audit"
import { describeStop } from "./crash.js"
import { writeZip } from "./update/zip.js"

/** The newest part of host.log that goes in. */
export const LOG_TAIL_BYTES = 2 * 1024 * 1024
export const AUDIT_RECORDS = 200

export interface BundleSources {
  logPath: string
  auditDir: string
  version: string
  platform?: NodeJS.Platform
  doctorReport: () => Promise<string>
  settings: () => unknown
  redactTerms: () => readonly string[]
}

export type BundleFiles = Record<string, string>

function tail(file: string, bytes: number): string {
  try {
    const size = fs.statSync(file).size
    const fd = fs.openSync(file, "r")
    try {
      const len = Math.min(size, bytes)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, size - len)
      const text = buf.toString("utf8")
      // Starts at a whole line.
      return size > bytes ? text.slice(text.indexOf("\n") + 1) : text
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ""
  }
}

/** The last records, as kind and outcome only. */
function auditOutcomes(dir: string, n: number): unknown[] {
  const out: unknown[] = []
  let files: string[] = []
  try {
    files = listAuditFiles(dir)
  } catch {
    return out
  }
  for (const file of [...files].reverse()) {
    let lines: string[]
    try {
      lines = fs.readFileSync(path.isAbsolute(file) ? file : path.join(dir, file), "utf8").split("\n").filter(Boolean).reverse()
    } catch {
      continue
    }
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as { seq?: number; ts?: string; event?: string; channel?: string; tool?: string; verdict?: { outcome?: string; ruleId?: string; risk?: number } }
        out.push({ seq: r.seq, ts: r.ts, event: r.event, channel: r.channel, tool: r.tool, outcome: r.verdict?.outcome, rule: r.verdict?.ruleId, risk: r.verdict?.risk })
      } catch {
        // a torn line: left out
      }
      if (out.length >= n) return out.reverse()
    }
  }
  return out.reverse()
}

/** Every key path in the settings ("checkpoints.beforeEscalation"), never a value. */
export function keyNames(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => keyNames(v, prefix ? `${prefix}.${k}` : k))
}

function crashCodes(log: string): unknown[] {
  const counts = new Map<number, number>()
  for (const m of log.matchAll(/exited with code (-?\d+)/gi)) {
    const n = Number(m[1])
    if (!Number.isSafeInteger(n)) continue
    const code = n < 0 ? n >>> 0 : n
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts].map(([code, times]) => ({ code, hex: `0x${code.toString(16).toUpperCase()}`, times, meaning: describeStop(`process exited with code ${code}`) }))
}

/** What goes in the bundle, as file name and text, redacted. */
export async function bundleFiles(s: BundleSources): Promise<BundleFiles> {
  const terms = s.redactTerms()
  const red = (t: string) => redactString(t, { terms })
  const log = tail(s.logPath, LOG_TAIL_BYTES)
  return {
    "host.log": red(log),
    "version.json": JSON.stringify({ codehouse: s.version, platform: s.platform ?? process.platform, arch: process.arch, node: process.version, made: new Date().toISOString() }, null, 2),
    "doctor.txt": red(await s.doctorReport()),
    "audit-outcomes.json": JSON.stringify(auditOutcomes(s.auditDir, AUDIT_RECORDS), null, 1),
    "crash-codes.json": JSON.stringify(crashCodes(log), null, 2),
    "settings-keys.json": JSON.stringify(keyNames(s.settings()).sort(), null, 1),
  }
}

/** Writes exactly these files as a zip; returns where. */
export async function writeBundle(files: BundleFiles, dir: string, now = new Date()): Promise<string> {
  fs.mkdirSync(dir, { recursive: true })
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-bundle-"))
  try {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(stage, name), text)
    const out = path.join(dir, `codehouse-crash-bundle-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`)
    await writeZip(out, stage, Object.keys(files), { date: now })
    return out
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

/**
 * POST /api/crash-bundle/preview: what would go in, kept for ten minutes under an id. POST /api/crash-bundle { id }:
 * saves exactly that preview to Downloads and records it. The preview and the zip cannot differ.
 */
export function registerCrashBundleRoutes(
  app: FastifyInstance,
  ctx: { sources: BundleSources; downloads?: string; record: (input: Record<string, unknown>) => Promise<boolean> },
): void {
  const previews = new Map<string, { files: BundleFiles; at: number }>()
  const fresh = () => {
    for (const [k, v] of previews) if (Date.now() - v.at > 10 * 60_000) previews.delete(k)
  }
  app.post("/api/crash-bundle/preview", async () => {
    fresh()
    const files = await bundleFiles(ctx.sources)
    const id = crypto.randomUUID()
    previews.set(id, { files, at: Date.now() })
    return { id, files }
  })
  app.post("/api/crash-bundle", async (req, reply) => {
    fresh()
    const id = (req.body as { id?: unknown } | undefined)?.id
    const p = typeof id === "string" ? previews.get(id) : undefined
    if (!p) return reply.code(409).send({ error: "That preview has gone. Make the crash bundle again." })
    previews.delete(id as string)
    const where = await writeBundle(p.files, ctx.downloads ?? path.join(os.homedir(), "Downloads"))
    const recorded = await ctx.record({ file: path.basename(where), files: Object.keys(p.files), bytes: fs.statSync(where).size })
    if (!recorded) {
      fs.rmSync(where, { force: true })
      return reply.code(503).send({ error: "The crash bundle could not be recorded, so it was not kept." })
    }
    return { file: where }
  })
}
