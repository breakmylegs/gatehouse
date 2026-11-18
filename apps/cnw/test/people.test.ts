// Uplift phase 4 (owner, 17 Nov): people with roles. An invite is a link used once; a viewer only looks, an approver
// answers what waits and nothing more, an admin runs the server but cannot touch an owner, and there is always an owner.
// A person given some computers sees only those.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { commandAllowed, httpAllowed, roleMay, roleOf } from "../src/roles.js"
import { createCnw } from "../src/server.js"

const ORIGIN = "https://cnw.home.arpa"
const PW = "a long password here"
let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-people-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("what each role may do", () => {
  it("lets a viewer look, an approver answer, an admin run the server but not owners, and an older account be an owner", () => {
    expect(roleOf(undefined)).toBe("owner")
    expect(["view", "answer", "pair", "server", "people", "owners"].filter((x) => roleMay("viewer", x))).toEqual(["view"])
    expect(["view", "answer", "pair", "server", "people", "owners"].filter((x) => roleMay("approver", x))).toEqual(["view", "answer"])
    expect(roleMay("admin", "server") && roleMay("admin", "people") && !roleMay("admin", "owners")).toBe(true)
    expect(commandAllowed("approver", { type: "approve", requestId: "r" })).toBe(true)
    for (const type of ["prompt", "rearm", "kill", "set_mode"]) expect(commandAllowed("approver", { type }), type).toBe(false)
    expect(commandAllowed("viewer", { type: "deny" })).toBe(false)
    expect(httpAllowed("approver", "GET") && !httpAllowed("approver", "POST") && httpAllowed("admin", "PUT")).toBe(true)
  })
})

describe("people", () => {
  async function owner() {
    const lines: string[] = []
    const { app } = await createCnw({ dataDir: dir, publicUrl: ORIGIN, log: (l) => void lines.push(l), webDir: path.join(dir, "none") })
    const code = /shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
    const s = await app.inject({ method: "POST", url: "/api/setup", payload: { code, email: "ana@example.com", password: PW } })
    const headers = { cookie: String(s.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": s.json().csrf as string }
    const join = async (email: string, role: string, by = headers, computers?: string[]) => {
      const inv = await app.inject({ method: "POST", url: "/api/people/invite", headers: by, payload: { email, role, ...(computers ? { computers } : {}) } })
      if (inv.statusCode !== 200) return { status: inv.statusCode, headers: undefined }
      const token = new URL(inv.json().link as string).hash.replace("#invite=", "")
      const acc = await app.inject({ method: "POST", url: "/api/invite/accept", payload: { token, password: PW } })
      return { status: acc.statusCode, token, headers: { cookie: String(acc.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": acc.json().csrf as string } }
    }
    return { app, headers, join }
  }

  it("joins by an invite link used once, with the role it was given", async () => {
    const o = await owner()
    const bo = await o.join("bo@example.com", "viewer")
    expect(bo.status).toBe(200)
    expect((await o.app.inject({ method: "GET", url: "/api/me", headers: bo.headers })).json()).toMatchObject({ user: "bo@example.com", role: "viewer" })
    expect((await o.app.inject({ method: "POST", url: "/api/invite/accept", payload: { token: bo.token, password: PW } })).statusCode).toBe(403)
    expect((await o.app.inject({ method: "POST", url: "/api/login", payload: { login: "bo@example.com", password: PW } })).statusCode).toBe(200)
    await o.app.close()
  })

  it("keeps a viewer and an approver to looking and answering, and a person given some computers to those", async () => {
    const o = await owner()
    const viewer = (await o.join("vi@example.com", "viewer")).headers!
    const approver = (await o.join("ap@example.com", "approver", o.headers, ["c-1"])).headers!
    expect((await o.app.inject({ method: "GET", url: "/api/board", headers: viewer })).statusCode).toBe(200)
    expect((await o.app.inject({ method: "POST", url: "/api/inbox/answer", headers: viewer, payload: { computer: "c-1", requestId: "r", decision: "deny" } })).statusCode).toBe(403)
    for (const h of [viewer, approver]) {
      expect((await o.app.inject({ method: "POST", url: "/api/computers/code", headers: h, payload: { label: "" } })).statusCode).toBe(403)
      expect((await o.app.inject({ method: "GET", url: "/api/server", headers: h })).statusCode).toBe(403)
      expect((await o.app.inject({ method: "GET", url: "/api/people", headers: h })).statusCode).toBe(403)
      expect((await o.app.inject({ method: "POST", url: "/c/c-1/api/settings", headers: h, payload: {} })).statusCode).toBe(403)
    }
    // The approver sees c-1 only; another computer's API is not theirs.
    expect((await o.app.inject({ method: "GET", url: "/c/c-2/api/state", headers: approver })).statusCode).toBe(404)
    await o.app.close()
  })

  it("lets an admin invite and manage people but never an owner, and always keeps an owner", async () => {
    const o = await owner()
    const admin = (await o.join("ad@example.com", "admin")).headers!
    expect((await o.join("vi@example.com", "viewer", admin)).status).toBe(200)
    expect((await o.join("ow@example.com", "owner", admin)).status).toBe(403)
    expect((await o.app.inject({ method: "PATCH", url: "/api/people/ana@example.com", headers: admin, payload: { role: "viewer" } })).statusCode).toBe(403)
    expect((await o.app.inject({ method: "DELETE", url: "/api/people/ana@example.com", headers: admin })).statusCode).toBe(403)
    // The owner cannot make themselves anything else while they are the only one.
    expect((await o.app.inject({ method: "PATCH", url: "/api/people/ana@example.com", headers: o.headers, payload: { role: "admin" } })).statusCode).toBe(409)
    expect((await o.app.inject({ method: "PATCH", url: "/api/people/vi@example.com", headers: admin, payload: { role: "approver", computers: ["c-1"] } })).statusCode).toBe(200)
    // Removed: signed out at once.
    const vi = await o.app.inject({ method: "POST", url: "/api/login", payload: { login: "vi@example.com", password: PW } })
    const viHeaders = { cookie: String(vi.headers["set-cookie"]).split(";")[0]! }
    expect((await o.app.inject({ method: "DELETE", url: "/api/people/vi@example.com", headers: admin })).statusCode).toBe(200)
    expect((await o.app.inject({ method: "GET", url: "/api/board", headers: viHeaders })).statusCode).toBe(401)
    await o.app.close()
  })
})
