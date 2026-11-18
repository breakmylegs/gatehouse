// Uplift phase 2 (owner, 17 Nov): CNW's address, certificate and port are set on its Server page, not in .env; a change
// that gives a new certificate says which computers it unpairs before it is made; only a signed-in person sees or
// changes them; each change is audited; and the updater checks what it is asked to apply.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createCnw } from "../src/server.js"
import { checkSettings, effective, grouped, newCertificate } from "../src/server-settings.js"
import { applyCommands, updaterServer } from "../src/updater.js"

const ORIGIN = "https://192.168.1.225"
const PW = "a long password here"
let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-settings-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the Server page's settings", () => {
  it("takes a name or an address only, and knows which changes make a new certificate", () => {
    expect(checkSettings({ host: "192.168.1.225", tls: "", port: "8443" })).toEqual({ settings: { host: "192.168.1.225", tls: "", port: "8443", trustedProxy: "" } })
    for (const host of ["cnw.example {\n\treverse_proxy evil", "", "a b"]) expect(checkSettings({ host })).toHaveProperty("error")
    expect(checkSettings({ host: "cnw.lan", port: "99999" })).toEqual({ error: expect.stringMatching(/^The port is/) })
    expect(checkSettings({ host: "cnw.lan", tls: "self" })).toEqual({ error: expect.stringMatching(/^The certificate choice is/) })
    const now = effective({ CNW_HOST: "192.168.1.225" }, {})
    expect(newCertificate(now, { host: "192.168.1.226", tls: "" })).toBe(true)
    expect(newCertificate(now, { host: "192.168.1.225", tls: "public" })).toBe(true)
    expect(newCertificate(now, { host: "192.168.1.225", tls: "internal" })).toBe(false)
    // A saved value wins over .env.
    expect(effective({ CNW_HOST: "a.lan", CNW_PORT: "8443" }, { host: "b.lan" })).toMatchObject({ host: "b.lan", port: "8443" })
    expect(grouped("AB12cd34ef")).toBe("ab12 cd34 ef")
  })

  it("shows and changes them only for a signed-in person, says what a new certificate unpairs, and audits each change", async () => {
    const lines: string[] = []
    const applied: Array<Record<string, string>> = []
    fs.mkdirSync(path.join(dir, "caddy"))
    const { app } = await createCnw({
      dataDir: dir,
      publicUrl: ORIGIN,
      log: (l) => void lines.push(l),
      webDir: path.join(dir, "none"),
      env: { CNW_HOST: "192.168.1.225" },
      caddyConfigDir: path.join(dir, "caddy"),
      certificateOf: async () => "ab".repeat(32),
      applySettings: async (s) => (applied.push(s), { ok: true, message: "Applying." }),
    })
    const code = /shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
    const s = await app.inject({ method: "POST", url: "/api/setup", payload: { code, email: "ana@example.com", password: PW } })
    const headers = { cookie: String(s.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": s.json().csrf as string }
    // An allowed network may look at the computers, but not at the server's settings.
    await app.inject({ method: "PUT", url: "/api/allowlist", headers, payload: { ranges: ["127.0.0.0/8"] } })
    expect((await app.inject({ method: "GET", url: "/api/server" })).statusCode).toBe(401)
    expect((await app.inject({ method: "PUT", url: "/api/server", payload: { host: "evil.example" } })).statusCode).toBe(401)

    const view = (await app.inject({ method: "GET", url: "/api/server", headers })).json()
    expect(view).toMatchObject({ effective: { host: "192.168.1.225" }, certificate: grouped("ab".repeat(32)), rootCertificate: false })

    // A port keeps the certificate: saved and applied at once.
    const port = await app.inject({ method: "PUT", url: "/api/server", headers, payload: { host: "192.168.1.225", tls: "", port: "8443" } })
    expect(port.statusCode).toBe(200)
    expect(applied).toEqual([{ host: "192.168.1.225", tls: "", port: "8443" }])
    // .env still says 443: Docker would publish that at a start by hand, which the page warns about.
    expect((await app.inject({ method: "GET", url: "/api/server", headers })).json().portInEnv).toBe("")

    // A new address unpairs every computer: named first, applied only once confirmed.
    const made = await app.inject({ method: "POST", url: "/api/computers/code", headers, payload: { label: "Laptop" } })
    const crypto = await import("node:crypto")
    const pub = crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64url")
    await app.inject({ method: "POST", url: "/agent/pair", payload: { code: made.json().code, publicKey: pub, label: "Laptop" } })
    const move = { host: "cnw.home.arpa", tls: "", port: "8443" }
    const warned = await app.inject({ method: "PUT", url: "/api/server", headers, payload: move })
    expect(warned.statusCode).toBe(409)
    expect(warned.json().breaks).toEqual(["Laptop"])
    expect(applied).toHaveLength(1)
    expect((await app.inject({ method: "PUT", url: "/api/server", headers, payload: { ...move, confirm: true } })).statusCode).toBe(200)
    expect(applied.at(-1)).toEqual({ host: "cnw.home.arpa", tls: "", port: "8443" })

    // Each change is in CNW's audit, with who made it.
    const audit = JSON.parse(fs.readFileSync(path.join(dir, "audit.json"), "utf8")) as { entries: Array<{ user: string; action: string; detail: string }> }
    expect(audit.entries.map((e) => [e.user, e.action])).toEqual([
      ["ana@example.com", "server-settings"],
      ["ana@example.com", "server-settings"],
    ])
    expect(audit.entries[1]!.detail).toMatch(/cnw\.home\.arpa/)

    // The root certificate, once caddy has made it: the public part, to download and trust.
    expect((await app.inject({ method: "GET", url: "/api/server/root.crt", headers })).statusCode).toBe(404)
    fs.writeFileSync(path.join(dir, "caddy", "root.crt"), "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n")
    const crt = await app.inject({ method: "GET", url: "/api/server/root.crt", headers })
    expect(crt.statusCode).toBe(200)
    expect(crt.headers["content-type"]).toMatch(/x509-ca-cert/)
    await app.close()
  })
})

describe("applying them", () => {
  it("writes caddy's configuration again and recreates caddy and cnw, or only cnw behind your own proxy", () => {
    const s = { host: "192.168.1.225", tls: "", port: "8443" }
    expect(applyCommands(s, false)).toEqual({
      commands: [
        ["compose", "run", "--rm", "--no-deps", "cnw-config"],
        ["compose", "up", "-d", "--force-recreate", "--no-deps", "caddy", "cnw"],
      ],
      env: { CNW_HOST: "192.168.1.225", CNW_TLS: "", CNW_PORT: "8443" },
    })
    expect(applyCommands(s, true).commands).toEqual([["compose", "up", "-d", "--force-recreate", "--no-deps", "cnw"]])
  })

  it("checks what it is asked to apply again, answers before it restarts anything, and runs one change at a time", async () => {
    const asked: unknown[] = []
    let finish: () => void = () => undefined
    const server = updaterServer(
      async () => "x",
      (s) => (asked.push(s), new Promise<void>((r) => (finish = r))),
    )
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const at = `http://127.0.0.1:${(server.address() as { port: number }).port}/apply`
    const post = (body: unknown) => fetch(at, { method: "POST", body: JSON.stringify(body) })
    try {
      expect((await post({ host: "cnw.example {\n}" })).status).toBe(422)
      expect(asked).toHaveLength(0)
      expect((await post({ host: "192.168.1.225", port: "8443" })).status).toBe(202)
      expect(asked).toEqual([{ host: "192.168.1.225", tls: "", port: "8443", trustedProxy: "" }])
      expect((await post({ host: "192.168.1.225" })).status).toBe(409)
      finish()
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
