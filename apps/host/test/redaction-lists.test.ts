// E-080: a team's redaction list, signed with a trusted key, adds its words everywhere redaction runs (an export
// included); a list that removes a word, a tampered list, a newer copy that leaves a word out, and a list signed with
// an untrusted key are all refused; each import is audited with its size, never its words; and Settings still edits
// only your own words.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerExportRoutes } from "../src/export-api.js"
import { RedactionLists, registerRedactionListRoutes, withTeamTerms } from "../src/redaction-lists.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-redlists-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const keys = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  return { pem: publicKey.export({ format: "pem", type: "spki" }).toString(), sign: (s: string) => crypto.sign(null, Buffer.from(s), privateKey).toString("base64") }
}
const list = (terms: string[], extra: Record<string, unknown> = {}) => JSON.stringify({ name: "Acme team", source: "Acme security", date: "2026-11-18", terms, ...extra })

describe("shared redaction lists (E-080)", () => {
  it("adds a trusted list's words everywhere, an export included, and Settings keeps only your own", async () => {
    const k = keys()
    const lists = new RedactionLists(dir)
    const json = list(["Project Falcon", "db01.acme.internal"])
    lists.import(json, k.sign(json), [k.pem])
    const config = { redactTerms: ["My Client"] } as { redactTerms: string[] }
    const team = withTeamTerms(config, lists)
    expect(config.redactTerms).toEqual(["My Client", "Project Falcon", "db01.acme.internal"])
    // Saving Settings sets your own words; the team's stay.
    config.redactTerms = ["Other Client"]
    expect(team.ownTerms()).toEqual(["Other Client"])
    expect(config.redactTerms).toContain("Project Falcon")
    const app = Fastify()
    registerExportRoutes(app, { audit: { record: async () => true } as never, config: () => config as never })
    const r = await app.inject({ method: "POST", url: "/api/export/redact", payload: { format: "md", preview: true, text: "We met about Project Falcon on db01.acme.internal." } })
    expect((r.json() as { text: string }).text).not.toMatch(/Falcon|db01/)
    await app.close()
  })

  it("refuses a list that removes a word, a tampered one, a newer copy that drops a word, and an untrusted key", () => {
    const k = keys()
    const lists = new RedactionLists(dir)
    const removes = list(["a word"], { remove: ["Project Falcon"] })
    expect(() => lists.import(removes, k.sign(removes), [k.pem])).toThrow(/only add words/)
    const signed = list(["Project Falcon", "Atlas"])
    const tampered = signed.replace("Atlas", "Atlis")
    expect(() => lists.import(tampered, k.sign(signed), [k.pem])).toThrow(/signature does not check out/)
    lists.import(signed, k.sign(signed), [k.pem])
    const fewer = list(["Project Falcon", "Orion"])
    expect(() => lists.import(fewer, k.sign(fewer), [k.pem])).toThrow(/leaves out 1 word/)
    const more = list(["Project Falcon", "Atlas", "Orion"])
    expect(lists.import(more, k.sign(more), [k.pem]).terms).toHaveLength(3)
    const stranger = keys()
    expect(() => lists.import(more, stranger.sign(more), [k.pem])).toThrow(/signature does not check out/)
    expect(() => lists.import(more, k.sign(more), [])).toThrow(/No trusted key/)
  })

  it("records each import with its size and source, never its words, and lists each with its source and date", async () => {
    const k = keys()
    const lists = new RedactionLists(dir)
    const recorded: Array<Record<string, unknown>> = []
    const app = Fastify()
    registerRedactionListRoutes(app, { lists, trustedKeys: () => [k.pem], record: async (i) => (recorded.push(i), true) })
    const json = list(["Project Falcon"])
    expect((await app.inject({ method: "POST", url: "/api/redaction-lists", payload: { list: json, signature: k.sign(json) } })).statusCode).toBe(200)
    expect(recorded).toEqual([expect.objectContaining({ name: "Acme team", source: "Acme security", date: "2026-11-18", words: 1 })])
    expect(JSON.stringify(recorded)).not.toContain("Falcon")
    const got = (await app.inject({ method: "GET", url: "/api/redaction-lists" })).json() as { lists: unknown[] }
    expect(got.lists).toEqual([expect.objectContaining({ name: "Acme team", source: "Acme security", date: "2026-11-18", words: 1 })])
    expect((await app.inject({ method: "POST", url: "/api/redaction-lists", payload: { list: json, signature: "AAAA" } })).statusCode).toBe(409)
    await app.close()
  })
})
