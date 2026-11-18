// Uplift phase 4 (owner, 17 Nov): a second factor that works at an IP address. Codes follow RFC 6238; with it on, a
// password alone signs nothing in; a code or a recovery code works once; signing in again for a Severe allow wants a
// code too; the secret is stored sealed; and each signed-in device can be signed out.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createCnw } from "../src/server.js"
import { base32, codeAt, Sealer, unbase32, verifyCode } from "../src/totp.js"

const ORIGIN = "https://192.168.1.225"
const PW = "a long password here"
let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-totp-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("TOTP codes", () => {
  it("match RFC 6238's test vector, accept a step either side, and never a step already used", () => {
    const secret = Buffer.from("12345678901234567890")
    // RFC 6238, appendix B: at 59 s the eight-digit code is 94287082, so the six-digit one is 287082.
    expect(codeAt(secret, 1)).toBe("287082")
    expect(unbase32(base32(secret)).equals(secret)).toBe(true)
    expect(verifyCode(secret, "287082", 59_000)).toBe(1)
    expect(verifyCode(secret, "287082", 89_000)).toBe(1)
    expect(verifyCode(secret, "287082", 59_000, 1)).toBeUndefined()
    expect(verifyCode(secret, "12345", 59_000)).toBeUndefined()
    const sealer = new Sealer(dir)
    const sealed = sealer.seal(secret)
    expect(sealed).not.toContain(base32(secret))
    expect(new Sealer(dir).open(sealed).equals(secret)).toBe(true)
  })
})

describe("signing in with a second factor", () => {
  it("wants a code after the password, takes each code and recovery code once, and asks for one to allow a Severe again", async () => {
    let now = Date.parse("2026-11-18T10:00:00Z")
    const lines: string[] = []
    const { app } = await createCnw({ dataDir: dir, publicUrl: ORIGIN, log: (l) => void lines.push(l), webDir: path.join(dir, "none"), now: () => now })
    const code = /shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
    const s = await app.inject({ method: "POST", url: "/api/setup", payload: { code, email: "ana@example.com", password: PW } })
    const headers = { cookie: String(s.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": s.json().csrf as string }
    const start = (await app.inject({ method: "POST", url: "/api/totp/start", headers })).json()
    expect(start.uri).toMatch(/^otpauth:\/\/totp\//)
    const secret = unbase32(start.key)
    const step = () => Math.floor(now / 30_000)
    expect((await app.inject({ method: "POST", url: "/api/totp/confirm", headers, payload: { code: "000000" } })).statusCode).toBe(403)
    const on = await app.inject({ method: "POST", url: "/api/totp/confirm", headers, payload: { code: codeAt(secret, step()) } })
    expect(on.statusCode).toBe(200)
    const recovery = on.json().recovery as string[]
    expect(recovery).toHaveLength(10)
    // The secret is not in the data file in the clear.
    expect(fs.readFileSync(path.join(dir, "users.json"), "utf8")).not.toContain(start.key.replace(/ /g, ""))

    // The password alone signs nothing in.
    const pw = await app.inject({ method: "POST", url: "/api/login", payload: { login: "ana@example.com", password: PW } })
    expect(pw.json()).toMatchObject({ totp: true })
    expect(pw.headers["set-cookie"]).toBeUndefined()
    // The code just used at confirming cannot be used again; the next one can.
    expect((await app.inject({ method: "POST", url: "/api/login/totp", payload: { ticket: pw.json().ticket, code: codeAt(secret, step()) } })).statusCode).toBe(401)
    now += 30_000
    const ok = await app.inject({ method: "POST", url: "/api/login/totp", payload: { ticket: pw.json().ticket, code: codeAt(secret, step()) } })
    expect(ok.statusCode).toBe(200)
    // A recovery code works once.
    const pw2 = await app.inject({ method: "POST", url: "/api/login", payload: { login: "ana@example.com", password: PW } })
    expect((await app.inject({ method: "POST", url: "/api/login/totp", payload: { ticket: pw2.json().ticket, code: recovery[0] } })).statusCode).toBe(200)
    const pw3 = await app.inject({ method: "POST", url: "/api/login", payload: { login: "ana@example.com", password: PW } })
    expect((await app.inject({ method: "POST", url: "/api/login/totp", payload: { ticket: pw3.json().ticket, code: recovery[0] } })).statusCode).toBe(401)

    // Signing in again for a Severe allow wants a code as well as the password.
    const h2 = { cookie: String(ok.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": ok.json().csrf as string }
    expect((await app.inject({ method: "POST", url: "/api/reauth", headers: h2, payload: { password: PW } })).statusCode).toBe(403)
    now += 30_000
    expect((await app.inject({ method: "POST", url: "/api/reauth", headers: h2, payload: { password: PW, code: codeAt(secret, step()) } })).statusCode).toBe(200)
    await app.close()
  })

  it("lists your signed-in devices and signs one out, and only your own", async () => {
    const lines: string[] = []
    const { app } = await createCnw({ dataDir: dir, publicUrl: ORIGIN, log: (l) => void lines.push(l), webDir: path.join(dir, "none") })
    const code = /shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
    await app.inject({ method: "POST", url: "/api/setup", payload: { code, email: "ana@example.com", password: PW } })
    const phone = await app.inject({ method: "POST", url: "/api/login", headers: { "user-agent": "iPhone Safari" }, payload: { login: "ana@example.com", password: PW } })
    const desk = await app.inject({ method: "POST", url: "/api/login", headers: { "user-agent": "Edge on Windows" }, payload: { login: "ana@example.com", password: PW } })
    const h = { cookie: String(desk.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": desk.json().csrf as string }
    const list = (await app.inject({ method: "GET", url: "/api/devices", headers: h })).json().devices as Array<{ id: string; ua?: string; current: boolean }>
    expect(list.filter((d) => d.ua === "iPhone Safari")).toHaveLength(1)
    expect(list.find((d) => d.current)?.ua).toBe("Edge on Windows")
    const iphone = list.find((d) => d.ua === "iPhone Safari")!
    expect((await app.inject({ method: "DELETE", url: `/api/devices/${iphone.id}`, headers: h })).statusCode).toBe(200)
    expect((await app.inject({ method: "GET", url: "/api/board", headers: { cookie: String(phone.headers["set-cookie"]).split(";")[0]! } })).statusCode).toBe(401)
    expect((await app.inject({ method: "DELETE", url: "/api/devices/0000000000000000", headers: h })).statusCode).toBe(404)
    await app.close()
  })
})
