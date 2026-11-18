// Uplift phase 5 (owner, 17 Nov): the server's own care. A backup cannot be read without its passphrase and brings
// everything back, including second factors; only an owner who signed in in the last five minutes makes or restores
// one; Health and the audit log show what CNW did; computers can be renamed and tagged; and going back to the previous
// version is the updater's, asked for only by someone who signed in recently.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeBackup, openBackup } from "../src/backup.js"
import { FRESH_MS } from "../src/board.js"
import { createCnw } from "../src/server.js"
import { rollbackCommands, updaterServer, verifyManifest } from "../src/updater.js"

const ORIGIN = "https://cnw.home.arpa"
const PW = "a long password here"
const PASS = "a backup passphrase"
let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-care-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

async function start(data = dir) {
  let now = Date.parse("2026-11-18T10:00:00Z")
  let exited = 0
  const lines: string[] = []
  const { app } = await createCnw({ dataDir: data, publicUrl: ORIGIN, log: (l) => void lines.push(l), webDir: path.join(data, "none"), now: () => now, exit: () => void exited++ })
  const code = /shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
  const s = code ? await app.inject({ method: "POST", url: "/api/setup", payload: { code, email: "ana@example.com", password: PW } }) : undefined
  const headers = s ? { cookie: String(s.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": s.json().csrf as string } : undefined
  return { app, headers, later: (ms: number) => (now += ms), exited: () => exited }
}

describe("backup and restore", () => {
  it("cannot be read without its passphrase, and refuses a wrong one or a changed file", () => {
    fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify({ users: [{ name: "ana", email: "ana@example.com", password: "scrypt$x" }] }))
    fs.writeFileSync(path.join(dir, "seal.key"), crypto.randomBytes(32).toString("base64"))
    const b = makeBackup(dir, PASS)
    expect(b).not.toContain("ana@example.com")
    expect(openBackup(b, PASS).files["users.json"]).toContain("ana@example.com")
    expect(() => openBackup(b, "another passphrase")).toThrow(/passphrase/)
    const parts = b.split(".")
    parts[5] = parts[5]!.slice(0, -4) + "AAAA"
    expect(() => openBackup(parts.join("."), PASS)).toThrow(/passphrase|changed/)
    expect(() => openBackup("hello", PASS)).toThrow(/not a Neighbourhood Watch backup/)
  })

  it("is made and restored only by an owner who signed in recently, brings the people back, and starts CNW again", async () => {
    const a = await start()
    const made = await a.app.inject({ method: "POST", url: "/api/backup", headers: a.headers!, payload: { passphrase: PASS } })
    expect(made.statusCode).toBe(200)
    expect(made.headers["content-disposition"]).toMatch(/\.cnwbackup/)
    expect((await a.app.inject({ method: "POST", url: "/api/backup", headers: a.headers!, payload: { passphrase: "short" } })).statusCode).toBe(422)
    // Signed in long ago: sign in again first.
    a.later(FRESH_MS + 1000)
    expect((await a.app.inject({ method: "POST", url: "/api/backup", headers: a.headers!, payload: { passphrase: PASS } })).statusCode).toBe(428)
    await a.app.close()

    // A new, empty CNW: its first owner restores the backup, and the old account signs in again.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-care2-"))
    try {
      const b = await start(other)
      expect((await b.app.inject({ method: "POST", url: "/api/restore", headers: b.headers!, payload: { backup: made.body, passphrase: "wrong passphrase" } })).statusCode).toBe(422)
      const r = await b.app.inject({ method: "POST", url: "/api/restore", headers: b.headers!, payload: { backup: made.body, passphrase: PASS } })
      expect(r.statusCode).toBe(200)
      await new Promise((res) => setTimeout(res, 600))
      expect(b.exited()).toBe(1)
      await b.app.close()
      const after = await start(other)
      expect((await after.app.inject({ method: "POST", url: "/api/login", payload: { login: "ana@example.com", password: PW } })).statusCode).toBe(200)
      const audit = JSON.parse(fs.readFileSync(path.join(other, "audit.json"), "utf8")) as { entries: Array<{ action: string }> }
      expect(audit.entries.map((e) => e.action)).toContain("restore")
      await after.app.close()
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })
})

describe("health, the audit log and computers", () => {
  it("shows health and the audit log to whoever runs the server, and renames and tags a computer", async () => {
    const a = await start()
    const h = (await a.app.inject({ method: "GET", url: "/api/health", headers: a.headers! })).json()
    expect(h).toMatchObject({ memory: { total: expect.any(Number) }, uptimeSeconds: expect.any(Number), computers: [] })
    const made = await a.app.inject({ method: "POST", url: "/api/computers/code", headers: a.headers!, payload: { label: "Laptop" } })
    const pub = crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64url")
    const id = (await a.app.inject({ method: "POST", url: "/agent/pair", payload: { code: made.json().code, publicKey: pub, label: "Laptop" } })).json().computer as string
    expect((await a.app.inject({ method: "PATCH", url: `/api/computers/${id}`, headers: a.headers!, payload: { label: "Work laptop", tags: ["work"] } })).statusCode).toBe(200)
    expect((await a.app.inject({ method: "GET", url: "/api/computers", headers: a.headers! })).json().computers[0]).toMatchObject({ label: "Work laptop", tags: ["work"] })
    const log = (await a.app.inject({ method: "GET", url: "/api/audit?limit=1", headers: a.headers! })).json()
    expect(log.entries[0]).toMatchObject({ action: "computer-renamed", user: "ana@example.com" })
    expect(log.total).toBeGreaterThanOrEqual(1)
    await a.app.close()
  })
})

describe("updates and going back", () => {
  it("reads release notes from the signed manifest only, and goes back with the kept image and commit", async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
    const json = JSON.stringify({ version: "1.3.0", commit: "b".repeat(40), notes: "The board across computers." })
    expect(verifyManifest(json, crypto.sign(null, Buffer.from(json), privateKey).toString("base64"), publicKey.export({ format: "pem", type: "spki" }).toString())?.notes).toBe("The board across computers.")
    expect(rollbackCommands("c".repeat(40))).toEqual([
      ["git", "-c", "safe.directory=REPO", "checkout", "--detach", "c".repeat(40)],
      ["docker", "image", "tag", "codehouse-cnw:previous", "codehouse-cnw:latest"],
      ["docker", "compose", "up", "-d", "--force-recreate", "--no-deps", "cnw"],
    ])
    let back = 0
    const server = updaterServer(async () => "x", undefined, { rollback: async () => void back++, info: async () => ({ current: "1.2.0", newer: true }) })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const at = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      expect(await (await fetch(`${at}/info`)).json()).toEqual({ current: "1.2.0", newer: true })
      expect((await fetch(`${at}/rollback`, { method: "POST" })).status).toBe(202)
      await new Promise((r) => setTimeout(r, 20))
      expect(back).toBe(1)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it("asks the updater to go back only for someone who signed in recently", async () => {
    const a = await start()
    a.later(FRESH_MS + 1000)
    expect((await a.app.inject({ method: "POST", url: "/api/update/rollback", headers: a.headers! })).statusCode).toBe(428)
    await a.app.close()
  })
})
