// CH-04: importing a claude.ai export from the desktop, audited, with each instruction and memory accepted by you.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { ChatStore } from "../src/chat/db.js"
import { registerImportRoutes } from "../src/chat/import-api.js"
import type { HostAudit } from "../src/hostaudit.js"
import { perProjectLayout } from "./fixtures/chat-export.js"
import { makeZip } from "./fixtures/zip-fixture.js"

let dir: string | undefined
const close: Array<() => unknown> = []
afterEach(async () => {
  for (const c of close.splice(0)) await c()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function setup(zip: Buffer | undefined) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-importapi-"))
  const store = new ChatStore({ file: path.join(dir, "chat.db"), redact: (v) => v })
  const file = path.join(dir, "export.zip")
  if (zip) fs.writeFileSync(file, zip)
  const records: Array<Record<string, unknown>> = []
  const app = Fastify()
  registerImportRoutes(app, {
    store,
    pickZip: async () => (zip ? file : undefined),
    audit: {
      record: async (r: Record<string, unknown>) => (records.push(r), true),
    } as unknown as HostAudit,
    policyHash: () => "h",
    tmpDir: dir,
  })
  close.push(
    () => app.close(),
    () => store.close(),
  )
  return { app, store, records }
}

describe("importing from the desktop", () => {
  it("imports the zip you chose and records the batch by its fingerprint, layout and counts", async () => {
    const { app, records } = setup(perProjectLayout())
    const r = (await app.inject({ method: "POST", url: "/api/chat/import" })).json()
    expect(r).toMatchObject({ ok: true, layout: "per-project", counts: { imported: 2 } })
    expect(records).toEqual([
      expect.objectContaining({
        event: "chat_import",
        input: expect.objectContaining({
          zipSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          layout: "per-project",
          imported: 2,
        }),
        verdict: expect.objectContaining({ ruleId: "chat-import", decidedBy: "human-desktop" }),
      }),
    ])
  })

  it("does nothing when you cancel, and says why nothing was imported when the zip is refused", async () => {
    const cancelled = setup(undefined)
    expect(
      (await cancelled.app.inject({ method: "POST", url: "/api/chat/import" })).json(),
    ).toEqual({ cancelled: true })
    expect(cancelled.records).toEqual([])
    await Promise.all(close.splice(0).map((c) => c()))
    fs.rmSync(dir!, { recursive: true, force: true })
    const attack = setup(makeZip([{ name: "../../evil.json", data: "{}" }]))
    const r = await attack.app.inject({ method: "POST", url: "/api/chat/import" })
    expect(r.statusCode).toBe(422)
    expect(r.json().error).toMatch(/may not unpack.*Nothing was imported/)
    expect(attack.records).toEqual([])
  })

  it("lists what waits to be accepted, and records each one you accept or turn down", async () => {
    const { app, records } = setup(perProjectLayout())
    await app.inject({ method: "POST", url: "/api/chat/import" })
    const pending = (await app.inject({ url: "/api/chat/import/pending" })).json() as {
      projects: Array<{ id: string }>
      memories: Array<{ id: string }>
    }
    expect(pending.projects).toHaveLength(1)
    expect(pending.memories).toHaveLength(2)
    const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload })
    expect(
      (await post("/api/chat/import/accept", { kind: "project", id: pending.projects[0]!.id }))
        .statusCode,
    ).toBe(200)
    expect(
      (await post("/api/chat/import/accept", { kind: "memory", id: pending.memories[0]!.id }))
        .statusCode,
    ).toBe(200)
    expect(
      (await post("/api/chat/import/dismiss", { id: pending.memories[1]!.id })).statusCode,
    ).toBe(200)
    expect(
      (await post("/api/chat/import/accept", { kind: "memory", id: "nothing" })).statusCode,
    ).toBe(404)
    expect(records.map((r) => r.event)).toEqual([
      "chat_import",
      "chat_import_instructions_accepted",
      "chat_import_memory_accepted",
      "chat_import_memory_dismissed",
    ])
  })
})
