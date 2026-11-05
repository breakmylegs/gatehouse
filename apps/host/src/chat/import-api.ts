import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { HostAudit } from "../hostaudit.js"
import type { ChatStore } from "./db.js"
import { ImportError, importExport } from "./import/importer.js"
import { ZipRefused } from "./import/zip.js"
import { JsonStreamError } from "./import/json-stream.js"

export interface ImportDeps {
  store: ChatStore
  /** The Windows file window, for one zip. Undefined when you cancel. */
  pickZip: () => Promise<string | undefined>
  audit: HostAudit
  policyHash: () => string
  tmpDir: string
}

const desktop = (d: ImportDeps, event: string, input: unknown, reason: string) =>
  d.audit.record({
    session: "desktop",
    event,
    channel: "desktop",
    tool: "chat-import",
    input,
    verdict: {
      outcome: "allow",
      ruleId: event.replace(/_/g, "-"),
      reason,
      risk: 0,
      decidedBy: "human-desktop",
      policyHash: d.policyHash(),
    },
    latencyMs: 0,
  })

/**
 * CH-04: importing a claude.ai export from the desktop. You choose the zip in the Windows file window (nothing from the
 * request names a file); each import is one audit entry with the zip's SHA-256, its layout and its counts; and each
 * project's instructions and each memory entry is accepted or turned down by you, one at a time, and audited.
 */
export function registerImportRoutes(app: FastifyInstance, d: ImportDeps): void {
  let running = false
  app.post("/api/chat/import", async (_req, reply) => {
    if (running) return reply.code(409).send({ error: "An import is already running." })
    const file = await d.pickZip()
    if (!file) return { cancelled: true }
    running = true
    try {
      const r = await importExport({ file, store: d.store, tmpDir: d.tmpDir })
      await desktop(
        d,
        "chat_import",
        { zipSha256: r.zipSha256, layout: r.layout, ...r.counts, skippedRecords: r.skipped.length },
        "A claude.ai export was imported into Chat, read only.",
      )
      return { ok: true, layout: r.layout, counts: r.counts, skipped: r.skipped }
    } catch (e) {
      if (e instanceof ImportError)
        return reply.code(422).send({ error: e.message, ...(e.files ? { files: e.files } : {}) })
      if (e instanceof ZipRefused || e instanceof JsonStreamError)
        return reply.code(422).send({ error: `${e.message} Nothing was imported.` })
      throw e
    } finally {
      running = false
    }
  })

  app.get("/api/chat/import/pending", async () => d.store.pendingImports())

  app.post("/api/chat/import/accept", async (req, reply) => {
    const b = z
      .object({ kind: z.enum(["project", "memory"]), id: z.string().max(100) })
      .safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: "not an imported item" })
    if (!d.store.accept(b.data.kind, b.data.id))
      return reply.code(404).send({ error: "There is no such item waiting." })
    await desktop(
      d,
      b.data.kind === "project"
        ? "chat_import_instructions_accepted"
        : "chat_import_memory_accepted",
      { id: b.data.id },
      b.data.kind === "project"
        ? "You accepted an imported project's instructions."
        : "You accepted an imported memory entry.",
    )
    return { ok: true }
  })

  app.post("/api/chat/import/dismiss", async (req, reply) => {
    const b = z.object({ id: z.string().max(100) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: "not an imported item" })
    if (!d.store.dismissMemory(b.data.id))
      return reply.code(404).send({ error: "There is no such item waiting." })
    await desktop(
      d,
      "chat_import_memory_dismissed",
      { id: b.data.id },
      "You turned down an imported memory entry.",
    )
    return { ok: true }
  })
}
