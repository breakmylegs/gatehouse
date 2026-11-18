// Notification channels (owner, 17 Nov): email, ntfy, Pushover, Telegram and webhooks, each with its own rule. No
// channel reaches CNW's own network (even by a public name that points there); a message never carries the command;
// email never sends a password before TLS; a secret is sealed and never sent back; and a forgotten password is reset by
// an emailed link used once, with the same answer whether or not the email has an account.
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { assertOutside, checkUrl, internalHost, ruleAllows, sendMail, sendTo, type Channel } from "../src/channels.js"
import { createCnw } from "../src/server.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-chan-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const at = (hh: number, mm = 0) => new Date(2026, 10, 18, hh, mm)

describe("where a channel may post", () => {
  it("never into CNW's own network or this machine, by address or by a name that points there", async () => {
    for (const h of ["updater", "docker-proxy", "caddy", "cnw", "localhost", "127.0.0.1", "172.30.0.10", "[::1]", "169.254.169.254", "x.localhost"]) expect(internalHost(h), h).toBe(true)
    for (const h of ["ntfy.sh", "192.168.1.50", "172.31.0.1", "hooks.example.com"]) expect(internalHost(h), h).toBe(false)
    expect(checkUrl("https://updater:8090/update", "It")).toMatch(/own network/)
    expect(checkUrl("http://ntfy.sh/topic", "It")).toMatch(/https/)
    expect(checkUrl("https://ntfy.sh/topic", "It")).toBeInstanceOf(URL)
    await expect(assertOutside("evil.example", async () => [{ address: "172.30.0.20" }])).rejects.toThrow(/own network/)
    await expect(assertOutside("ntfy.sh", async () => [{ address: "159.203.148.75" }])).resolves.toBeUndefined()
  })
})

describe("a channel's rule", () => {
  it("tells from its risk, about its computers, and waits through its quiet hours, across midnight too", () => {
    const w = { computer: "c1", risk: 75 }
    expect(ruleAllows({ minRisk: 0 }, w, at(12))).toBe(true)
    expect(ruleAllows({ minRisk: 85 }, w, at(12))).toBe(false)
    expect(ruleAllows({ minRisk: 0, computers: ["c2"] }, w, at(12))).toBe(false)
    const night = { minRisk: 0, quiet: { from: "22:00", to: "07:00" } }
    expect(ruleAllows(night, w, at(23, 30))).toBe(false)
    expect(ruleAllows(night, w, at(6, 59))).toBe(false)
    expect(ruleAllows(night, w, at(7, 0))).toBe(true)
  })
})

describe("sending", () => {
  it("signs a webhook with its secret and puts the token where each service wants it, never the command", async () => {
    const posts: Array<{ url: string; headers: Record<string, string>; body: string }> = []
    const post = async (url: string, init: { headers: Record<string, string>; body: string }) => (posts.push({ url, ...init }), { status: 200 })
    const m = { title: "Laptop needs you", body: "Bash in billing, Severe 88", url: "https://cnw.home.arpa/#inbox" }
    const hook: Channel = { id: "1", kind: "webhook", on: true, rule: { minRisk: 0 }, config: { url: "https://hooks.example.com/cnw" } }
    await sendTo(hook, "shh", m, { post })
    const sig = crypto.createHmac("sha256", "shh").update(posts[0]!.body).digest("hex")
    expect(posts[0]!.headers["X-CNW-Signature"]).toBe(`sha256=${sig}`)
    await sendTo({ ...hook, kind: "telegram", config: { chat: "12345" } }, "123:abc", m, { post })
    expect(posts[1]!.url).toBe("https://api.telegram.org/bot123%3Aabc/sendMessage")
    await sendTo({ ...hook, kind: "ntfy", config: { url: "https://ntfy.sh/my-topic" } }, "tk", m, { post })
    expect(posts[2]!.headers).toMatchObject({ Title: "Laptop needs you", Authorization: "Bearer tk" })
    await expect(sendTo(hook, undefined, m, { post: async () => ({ status: 500 }) })).rejects.toThrow(/500/)
  })

  it("sends no email, and no password, to a server that will not start TLS", async () => {
    const heard: string[] = []
    const server = net.createServer((s) => {
      s.write("220 mail.example ready\r\n")
      s.on("data", (d) => {
        const line = d.toString()
        heard.push(line)
        if (line.startsWith("EHLO")) s.write("250-mail.example\r\n250 AUTH PLAIN\r\n")
        else s.write("250 ok\r\n")
      })
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const port = (server.address() as net.AddressInfo).port
    try {
      await expect(
        sendMail(
          { host: "mail.example", port, tls: "starttls", user: "ana", pass: "secret-password", from: "cnw@example.com", to: "ana@example.com", lookup: async () => [{ address: "203.0.113.5" }], connect: () => net.connect({ host: "127.0.0.1", port }) },
          "s",
          "t",
        ),
      ).rejects.toThrow(/does not offer STARTTLS, so nothing was sent/)
      expect(heard.join("")).not.toMatch(/AUTH|secret-password|MAIL FROM/)
    } finally {
      server.close()
    }
  })
})

describe("channels and password reset in CNW", () => {
  async function owner() {
    const lines: string[] = []
    const mails: Array<{ to: string; subject: string; text: string }> = []
    const posts: Array<{ url: string; body: Buffer }> = []
    const { app, hub, pushLook } = await createCnw({
      dataDir: dir,
      publicUrl: "https://cnw.home.arpa",
      log: (l) => void lines.push(l),
      webDir: path.join(dir, "none"),
      smtp: async (o, subject, text) => void mails.push({ to: o.to, subject, text }),
      post: async (url, init) => (posts.push({ url, body: init.body }), { status: 200 }),
    })
    const code = /shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
    const s = await app.inject({ method: "POST", url: "/api/setup", payload: { code, email: "ana@example.com", password: "a long password here" } })
    const headers = { cookie: String(s.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": s.json().csrf as string }
    return { app, hub, pushLook, headers, mails, posts }
  }

  it("keeps a channel's secret sealed and never sends it back, and tells it when something newly waits", async () => {
    const o = await owner()
    const add = await o.app.inject({ method: "POST", url: "/api/channels", headers: o.headers, payload: { kind: "ntfy", url: "https://ntfy.sh/ana-topic", secret: "tk-secret", rule: { minRisk: 0 } } })
    expect(add.statusCode).toBe(200)
    expect(JSON.stringify(add.json())).not.toContain("tk-secret")
    expect(fs.readFileSync(path.join(dir, "channels.json"), "utf8")).not.toContain("tk-secret")
    expect((await o.app.inject({ method: "POST", url: "/api/channels", headers: o.headers, payload: { kind: "webhook", url: "https://updater:8090/update" } })).statusCode).toBe(422)
    // A computer with one request newly waiting.
    const made = await o.app.inject({ method: "POST", url: "/api/computers/code", headers: o.headers, payload: { label: "Laptop" } })
    const keys = crypto.generateKeyPairSync("ed25519")
    const id = (await o.app.inject({ method: "POST", url: "/agent/pair", payload: { code: made.json().code, publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url"), label: "Laptop" } })).json().computer as string
    let pending: unknown[] = []
    const sock = {
      send: (d: string) => {
        const m = JSON.parse(d) as Record<string, unknown>
        if (m.type === "challenge") queueMicrotask(() => o.hub.agentMessage(sock, JSON.stringify({ type: "hello", computer: id, protocol: 2, signature: crypto.sign(null, Buffer.from(m.challenge as string), keys.privateKey).toString("base64url") })))
        if (m.type === "http") queueMicrotask(() => o.hub.agentMessage(sock, JSON.stringify({ type: "http_reply", id: m.id, status: 200, body: Buffer.from(JSON.stringify({ sessions: [], pending, health: {} })).toString("base64") })))
      },
      close: () => undefined,
    }
    o.hub.agentOpened(sock)
    await new Promise((r) => setTimeout(r, 10))
    await o.pushLook()
    pending = [{ request: { id: "r1", toolName: "Bash", input: { command: "cat /srv/client-secrets" }, project: "billing", verdict: { risk: 60 }, createdAt: new Date().toISOString() } }]
    expect(await o.pushLook()).toBe(1)
    expect(o.posts[0]!.url).toBe("https://ntfy.sh/ana-topic")
    expect(o.posts[0]!.body.toString()).toBe("Bash in billing, Moderate 60")
    await o.app.close()
  })

  it("resets a forgotten password by an emailed link used once, with the same answer for an email it does not know", async () => {
    const o = await owner()
    await o.app.inject({ method: "POST", url: "/api/channels", headers: o.headers, payload: { kind: "email", host: "smtp.example.com", port: "587", from: "cnw@example.com", to: "ana@example.com", rule: { minRisk: 70 } } })
    const unknown = await o.app.inject({ method: "POST", url: "/api/password/forgot", payload: { email: "nobody@example.com" } })
    const known = await o.app.inject({ method: "POST", url: "/api/password/forgot", payload: { email: "ana@example.com" } })
    expect(unknown.json()).toEqual(known.json())
    expect(o.mails.map((m) => m.to)).toEqual(["ana@example.com"])
    const token = /#reset=([A-Za-z0-9_-]+)/.exec(o.mails[0]!.text)![1]!
    expect((await o.app.inject({ method: "POST", url: "/api/password/reset", payload: { token, password: "a brand new password" } })).statusCode).toBe(200)
    expect((await o.app.inject({ method: "POST", url: "/api/password/reset", payload: { token, password: "another new password" } })).statusCode).toBe(403)
    // The old sign-in is over; the new password signs in.
    expect((await o.app.inject({ method: "GET", url: "/api/board", headers: { cookie: o.headers.cookie } })).statusCode).toBe(401)
    const again = await o.app.inject({ method: "POST", url: "/api/login", payload: { login: "ana@example.com", password: "a brand new password" } })
    expect(again.statusCode).toBe(200)
    // An invite goes by email too (from the new sign-in: the reset signed every device out).
    const h2 = { cookie: String(again.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": again.json().csrf as string }
    const inv = await o.app.inject({ method: "POST", url: "/api/people/invite", headers: h2, payload: { email: "bo@example.com", role: "viewer" } })
    expect(inv.json().emailed).toBe(true)
    expect(o.mails.at(-1)).toMatchObject({ to: "bo@example.com" })
    await o.app.close()
  })
})
