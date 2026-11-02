// W1-13: an export reads the whole conversation from its start, and the Host masks it and records it first.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterAll, describe, expect, it } from "vitest"
import { registerExportRoutes } from "../src/export-api.js"
import { EXPORT_PAGE, SessionHistory, type SessionSdk } from "../src/history.js"
import { SessionMetaStore } from "../src/session-meta.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-export-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** A conversation of n messages, served in pages from its start, as the SDK's offset does. */
function longSdk(n: number): SessionSdk {
  const all = Array.from({ length: n }, (_, i) => ({
    type: i % 2 ? "assistant" : "user",
    message: { content: `message ${i}` },
    parent_tool_use_id: null,
  }))
  return {
    listSessions: async () => [],
    getSessionMessages: async (_id, o) =>
      all.slice(o?.offset ?? 0, (o?.offset ?? 0) + (o?.limit ?? n)),
    renameSession: async () => undefined,
  }
}

describe("exporting a conversation", () => {
  it("reads a session longer than 3,000 items from its start to its end", async () => {
    const h = new SessionHistory(longSdk(4500), new SessionMetaStore(path.join(dir, "meta.json")))
    const all = await h.allMessages("s1")
    expect(all).toHaveLength(4500)
    expect((all[0]?.message as { content: string }).content).toBe("message 0")
    expect((all.at(-1)?.message as { content: string }).content).toBe("message 4499")
    expect(EXPORT_PAGE).toBeLessThan(4500)
  })

  it("masks the redaction list and secrets, records the export, and never the text", async () => {
    const records: Array<Record<string, unknown>> = []
    const app = Fastify()
    registerExportRoutes(app, {
      audit: { record: async (e: Record<string, unknown>) => (records.push(e), true) } as never,
      config: () => ({ redactTerms: ["Project Falcon"] }) as never,
    })
    const r = await app.inject({
      method: "POST",
      url: "/api/export/redact",
      payload: {
        session: "s1",
        title: "Planning",
        format: "md",
        text: "We discussed Project Falcon.\nAPI_KEY=sk-live-123456789abcdef",
      },
    })
    expect(r.statusCode).toBe(200)
    const body = r.json() as { text: string; masked: number }
    expect(body.text).not.toMatch(/falcon/i)
    expect(body.text).not.toContain("sk-live-123456789abcdef")
    expect(body.masked).toBeGreaterThanOrEqual(2)
    expect(records[0]).toMatchObject({
      event: "conversation_exported",
      input: { format: "md", title: "Planning" },
    })
    expect(JSON.stringify(records[0])).not.toMatch(/falcon/i)
    await app.close()
  })

  it("masks a preview the same way, and does not record it as an export", async () => {
    const records: unknown[] = []
    const app = Fastify()
    registerExportRoutes(app, {
      audit: { record: async (e: unknown) => (records.push(e), true) } as never,
      config: () => ({ redactTerms: ["Project Falcon"] }) as never,
    })
    const r = await app.inject({
      method: "POST",
      url: "/api/export/redact",
      payload: { format: "md", text: "Project Falcon", preview: true },
    })
    expect((r.json() as { text: string }).text).not.toMatch(/falcon/i)
    expect(records).toEqual([])
    await app.close()
  })

  it("makes no export it could not record", async () => {
    const app = Fastify()
    registerExportRoutes(app, {
      audit: { record: async () => false } as never,
      config: () => ({}) as never,
    })
    const r = await app.inject({
      method: "POST",
      url: "/api/export/redact",
      payload: { format: "md", text: "hello" },
    })
    expect(r.statusCode).toBe(503)
    expect(r.json()).not.toHaveProperty("text")
    await app.close()
  })
})
