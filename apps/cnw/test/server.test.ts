// O41: the CNW server. The first account needs the logged setup code; sign-in sets a strict cookie and refuses wrong
// passwords with a growing wait; every change needs the CSRF token and CNW's own origin; the allow list refuses wide
// ranges and, even when it matches, still wants sign-in for the riskiest actions; a computer pairs once with a code.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createCnw } from "../src/server.js"

const ORIGIN = "https://cnw.home.arpa"
let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-server-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

async function start() {
  const lines: string[] = []
  const { app } = await createCnw({ dataDir: dir, publicUrl: ORIGIN, log: (l) => void lines.push(l), webDir: path.join(dir, "none") })
  const code = /Setup code for the first account \(shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
  return { app, code, lines }
}

const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers["set-cookie"] ?? "").split(";")[0]!

describe("CNW at an address, and behind a proxy", () => {
  it("refuses passkeys at an IP address, saying why, and keeps password sign-in", async () => {
    const lines: string[] = []
    const { app } = await createCnw({ dataDir: dir, publicUrl: "https://192.168.1.225:8443", log: (l) => void lines.push(l), webDir: path.join(dir, "none") })
    const me = (await app.inject({ method: "GET", url: "/api/me" })).json() as { passkeys: boolean; passkeyNote: string }
    expect(me.passkeys).toBe(false)
    expect(me.passkeyNote).toMatch(/browsers refuse them at an IP address/)
    expect((await app.inject({ method: "POST", url: "/api/passkey/login/options", headers: { origin: "https://192.168.1.225:8443" } })).statusCode).toBe(409)
    const code = /shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
    const setup = await app.inject({ method: "POST", url: "/api/setup", payload: { code, name: "ana", password: "a long password here" } })
    expect(setup.statusCode).toBe(200)
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { name: "ana", password: "a long password here" } })
    expect(login.statusCode).toBe(200)
    // Signed in, adding a passkey is refused the same way.
    const add = await app.inject({
      method: "POST",
      url: "/api/passkey/register/options",
      headers: { origin: "https://192.168.1.225:8443", cookie: cookieOf(login), "x-csrf-token": (login.json() as { csrf: string }).csrf },
    })
    expect(add.statusCode).toBe(409)
    await app.close()
  })

  it("offers passkeys at a name", async () => {
    const { app } = await start()
    expect(((await app.inject({ method: "GET", url: "/api/me" })).json() as { passkeys: boolean }).passkeys).toBe(true)
    await app.close()
  })

  it("ignores X-Forwarded-For with no trusted proxy, and believes it only from the trusted one", async () => {
    // Five wrong passwords from one connection, each under another name and claiming another address.
    const tries = async (app: Awaited<ReturnType<typeof createCnw>>["app"]) => {
      for (let i = 0; i < 5; i++)
        await app.inject({ method: "POST", url: "/api/login", remoteAddress: "10.0.0.5", headers: { "x-forwarded-for": `203.0.113.${i}` }, payload: { name: `n${i}`, password: "wrong" } })
      return (await app.inject({ method: "POST", url: "/api/login", remoteAddress: "10.0.0.5", headers: { "x-forwarded-for": "203.0.113.99" }, payload: { name: "n9", password: "wrong" } })).statusCode
    }
    const plain = await createCnw({ dataDir: dir, publicUrl: ORIGIN, log: () => undefined, webDir: path.join(dir, "none") })
    // The claimed addresses count for nothing: the one connection is throttled.
    expect(await tries(plain.app)).toBe(429)
    await plain.app.close()
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-proxy-"))
    try {
      const proxied = await createCnw({ dataDir: other, publicUrl: ORIGIN, trustedProxy: "192.168.1.10, 10.0.0.5", log: () => undefined, webDir: path.join(other, "none") })
      // From the trusted proxy, each claimed address is its own.
      expect(await tries(proxied.app)).toBe(401)
      await proxied.app.close()
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })
})

describe("the CNW server (O41)", () => {
  it("makes the first account only with the setup code, then signs in with a strict cookie", async () => {
    const { app, code } = await start()
    expect(code).toBeTruthy()
    const bad = await app.inject({ method: "POST", url: "/api/setup", payload: { code: "guess", name: "ana", password: "a long password here" } })
    expect(bad.statusCode).toBe(403)
    const ok = await app.inject({ method: "POST", url: "/api/setup", payload: { code, name: "ana", password: "a long password here" } })
    expect(ok.statusCode).toBe(200)
    expect(String(ok.headers["set-cookie"])).toMatch(/HttpOnly; Secure; SameSite=Strict/)
    const again = await app.inject({ method: "POST", url: "/api/setup", payload: { code, name: "bo", password: "another long password" } })
    expect(again.statusCode).toBe(403)
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { name: "ana", password: "a long password here" } })
    expect(login.statusCode).toBe(200)
    for (let i = 0; i < 5; i++) await app.inject({ method: "POST", url: "/api/login", payload: { name: "ana", password: "wrong" } })
    expect((await app.inject({ method: "POST", url: "/api/login", payload: { name: "ana", password: "a long password here" } })).statusCode).toBe(429)
    await app.close()
  })

  it("wants the CSRF token on a change, and refuses another site's origin", async () => {
    const { app, code } = await start()
    const s = await app.inject({ method: "POST", url: "/api/setup", payload: { code, name: "ana", password: "a long password here" } })
    const cookie = cookieOf(s)
    const csrf = s.json().csrf as string
    const put = (headers: Record<string, string>) =>
      app.inject({ method: "PUT", url: "/api/allowlist", headers: { cookie, ...headers }, payload: { ranges: ["192.168.1.0/24"] } })
    expect((await put({})).statusCode).toBe(403)
    expect((await put({ "x-csrf-token": csrf, origin: "https://evil.example" })).statusCode).toBe(403)
    expect((await put({ "x-csrf-token": csrf, origin: ORIGIN })).statusCode).toBe(200)
    const wide = await app.inject({ method: "PUT", url: "/api/allowlist", headers: { cookie, "x-csrf-token": csrf }, payload: { ranges: ["0.0.0.0/0"] } })
    expect(wide.statusCode).toBe(422)
    await app.close()
  })

  it("lets an allowed network look without signing in, but not remove a computer or change the list", async () => {
    const { app, code } = await start()
    const s = await app.inject({ method: "POST", url: "/api/setup", payload: { code, name: "ana", password: "a long password here" } })
    await app.inject({ method: "PUT", url: "/api/allowlist", headers: { cookie: cookieOf(s), "x-csrf-token": s.json().csrf }, payload: { ranges: ["127.0.0.0/8"] } })
    expect((await app.inject({ method: "GET", url: "/api/computers" })).statusCode).toBe(200)
    expect((await app.inject({ method: "DELETE", url: "/api/computers/x" })).statusCode).toBe(401)
    expect((await app.inject({ method: "PUT", url: "/api/allowlist", payload: { ranges: [] } })).statusCode).toBe(401)
    await app.close()
  })

  it("pairs a computer once with a code and an Ed25519 key", async () => {
    const { app, code } = await start()
    const s = await app.inject({ method: "POST", url: "/api/setup", payload: { code, name: "ana", password: "a long password here" } })
    const made = await app.inject({ method: "POST", url: "/api/computers/code", headers: { cookie: cookieOf(s), "x-csrf-token": s.json().csrf }, payload: { label: "Laptop" } })
    const pairCode = made.json().code as string
    const pub = crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64url")
    const first = await app.inject({ method: "POST", url: "/agent/pair", payload: { code: pairCode, publicKey: pub } })
    expect(first.statusCode).toBe(200)
    expect(typeof first.json().computer).toBe("string")
    expect((await app.inject({ method: "POST", url: "/agent/pair", payload: { code: pairCode, publicKey: pub } })).statusCode).toBe(403)
    await app.close()
  })
})
