// Web Push (owner, 17 Nov): a push is readable only by the browser that subscribed (RFC 8291, decrypted here as a
// browser does), is signed with CNW's own key (RFC 8292), and goes only to a known push service, never to an address
// a page makes up (CNW's private network included).
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createCnw } from "../src/server.js"
import { Sealer } from "../src/totp.js"
import { checkSubscription, encrypt, sendPush, Vapid, type Subscription } from "../src/webpush.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-push-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

/** A browser's subscription: its own key pair and auth secret, as PushManager.subscribe makes them. */
function browser(endpoint = "https://fcm.googleapis.com/fcm/send/abc123") {
  const ecdh = crypto.createECDH("prime256v1")
  ecdh.generateKeys()
  const auth = crypto.randomBytes(16)
  const sub: Subscription = { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } }
  /** RFC 8291, the receiving side, written from the RFC rather than from encrypt(). */
  const decrypt = (body: Buffer): string => {
    const salt = body.subarray(0, 16)
    const idlen = body.readUInt8(20)
    const asPublic = body.subarray(21, 21 + idlen)
    const shared = ecdh.computeSecret(asPublic)
    const h = (k: Buffer, d: Buffer) => crypto.createHmac("sha256", k).update(d).digest()
    const ikm = h(h(auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic, Buffer.from([1])])).subarray(0, 32)
    const prk = h(salt, ikm)
    const cek = h(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16)
    const nonce = h(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12)
    const rest = body.subarray(21 + idlen)
    const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce)
    d.setAuthTag(rest.subarray(rest.length - 16))
    const plain = Buffer.concat([d.update(rest.subarray(0, rest.length - 16)), d.final()])
    expect(plain.at(-1)).toBe(2)
    return plain.subarray(0, plain.length - 1).toString("utf8")
  }
  return { sub, decrypt }
}

describe("telling people what newly waits", () => {
  it("tells each subscribed person about a request newly waiting on a computer they see, at their risk, never the command", async () => {
    const lines: string[] = []
    const posts: Array<{ url: string; body: Buffer }> = []
    let status = 201
    const { app, hub, pushLook } = await createCnw({
      dataDir: dir,
      publicUrl: "https://cnw.home.arpa",
      log: (l) => void lines.push(l),
      webDir: path.join(dir, "none"),
      post: async (url, init) => (posts.push({ url, body: init.body }), { status }),
    })
    const code = /shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
    const s = await app.inject({ method: "POST", url: "/api/setup", payload: { code, email: "ana@example.com", password: "a long password here" } })
    const owner = { cookie: String(s.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": s.json().csrf as string }
    // A computer that waits on what this test says.
    const made = await app.inject({ method: "POST", url: "/api/computers/code", headers: owner, payload: { label: "Laptop" } })
    const keys = crypto.generateKeyPairSync("ed25519")
    const id = (await app.inject({ method: "POST", url: "/agent/pair", payload: { code: made.json().code, publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url"), label: "Laptop" } })).json().computer as string
    let waiting: unknown[] = []
    const sock = {
      send: (d: string) => {
        const m = JSON.parse(d) as Record<string, unknown>
        if (m.type === "challenge") queueMicrotask(() => hub.agentMessage(sock, JSON.stringify({ type: "hello", computer: id, protocol: 2, signature: crypto.sign(null, Buffer.from(m.challenge as string), keys.privateKey).toString("base64url") })))
        if (m.type === "http") queueMicrotask(() => hub.agentMessage(sock, JSON.stringify({ type: "http_reply", id: m.id, status: 200, body: Buffer.from(JSON.stringify({ sessions: [], pending: waiting, health: {} })).toString("base64") })))
      },
      close: () => undefined,
    }
    hub.agentOpened(sock)
    await new Promise((r) => setTimeout(r, 10))
    const req = (rid: string, risk: number) => ({ request: { id: rid, toolName: "Bash", input: { command: "rm -rf /srv/secret-client" }, project: "billing", verdict: { risk }, createdAt: new Date().toISOString() } })
    // Ana on every request; Bo, who sees no computer at all, too.
    const a = browser()
    const b = browser("https://updates.push.services.mozilla.com/wpush/v2/bo")
    expect((await app.inject({ method: "POST", url: "/api/push/subscribe", headers: owner, payload: { subscription: { ...a.sub, endpoint: "https://updater:8090/update" } } })).statusCode).toBe(422)
    expect((await app.inject({ method: "POST", url: "/api/push/subscribe", headers: owner, payload: { subscription: a.sub, minRisk: 70 } })).statusCode).toBe(200)
    const inv = await app.inject({ method: "POST", url: "/api/people/invite", headers: owner, payload: { email: "bo@example.com", role: "viewer", computers: ["another"] } })
    const acc = await app.inject({ method: "POST", url: "/api/invite/accept", payload: { token: new URL(inv.json().link).hash.slice(8), password: "a long password here" } })
    const bo = { cookie: String(acc.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": acc.json().csrf as string }
    expect((await app.inject({ method: "POST", url: "/api/push/subscribe", headers: bo, payload: { subscription: b.sub } })).statusCode).toBe(200)

    // The first look only learns what waits already.
    waiting = [req("r0", 90)]
    expect(await pushLook()).toBe(0)
    // Newly waiting: a Moderate one (under Ana's High), and a Severe one.
    waiting = [req("r0", 90), req("r1", 50), req("r2", 88)]
    expect(await pushLook()).toBe(1)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.url).toBe(a.sub.endpoint)
    const told = JSON.parse(a.decrypt(posts[0]!.body)) as { title: string; body: string }
    expect(told).toMatchObject({ title: "Laptop needs you", body: "Bash in billing, Severe 88" })
    expect(JSON.stringify(told)).not.toContain("secret-client")
    // Told once.
    expect(await pushLook()).toBe(0)
    // A browser that unsubscribed answers 410: forgotten.
    status = 410
    waiting = [req("r3", 95)]
    await pushLook()
    expect(JSON.parse(fs.readFileSync(path.join(dir, "push.json"), "utf8")).subs.map((x: { user: string }) => x.user)).toEqual(["bo@example.com"])
    await app.close()
  })
})

describe("Web Push", () => {
  it("encrypts a push so only the subscribed browser reads it, and the push service carries ciphertext", () => {
    const b = browser()
    const body = encrypt(b.sub, Buffer.from(JSON.stringify({ title: "Neighbourhood Watch", body: "Laptop: Bash in billing waits for you." })))
    expect(body.includes(Buffer.from("billing"))).toBe(false)
    expect(JSON.parse(b.decrypt(body))).toMatchObject({ body: "Laptop: Bash in billing waits for you." })
    // Another browser's keys cannot read it.
    expect(() => browser().decrypt(body)).toThrow()
  })

  it("signs each push with CNW's own key, kept sealed and the same after a restart", async () => {
    const sealer = new Sealer(dir)
    const vapid = new Vapid(dir, sealer)
    expect(new Vapid(dir, new Sealer(dir)).publicKey).toBe(vapid.publicKey)
    expect(fs.readFileSync(path.join(dir, "vapid.json"), "utf8")).not.toMatch(/PRIVATE/)
    const b = browser()
    const sent: Array<{ url: string; headers: Record<string, string>; body: Buffer }> = []
    expect(await sendPush(b.sub, { title: "t" }, vapid, "https://cnw.home.arpa", async (url, init) => (sent.push({ url, ...init }), { status: 201 }))).toBe("sent")
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(sent[0]!.headers.Authorization!)!
    expect(k).toBe(vapid.publicKey)
    const [h, c, sig] = jwt!.split(".")
    expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://cnw.home.arpa" })
    const raw = Buffer.from(vapid.publicKey, "base64url")
    const pub = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" })
    expect(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig!, "base64url"))).toBe(true)
    expect(sent[0]!.headers["Content-Encoding"]).toBe("aes128gcm")
    expect(JSON.parse(b.decrypt(sent[0]!.body))).toEqual({ title: "t" })
    // A browser that unsubscribed: forgotten.
    expect(await sendPush(b.sub, {}, vapid, "x", async () => ({ status: 410 }))).toBe("gone")
  })

  it("posts only to a known push service over https, never to an address a page makes up", async () => {
    const ok = browser().sub
    expect(checkSubscription(ok)).toEqual(ok)
    expect(typeof checkSubscription(browser("https://web.push.apple.com/QAbc").sub)).toBe("object")
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://updater:8090/update",
      "https://172.30.0.20/api",
      "https://fcm.googleapis.com.evil.example/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
    ])
      expect(typeof checkSubscription({ ...ok, endpoint }), endpoint).toBe("string")
    expect(typeof checkSubscription({ ...ok, keys: { p256dh: "AAAA", auth: ok.keys.auth } })).toBe("string")
    let posted = 0
    const vapid = new Vapid(dir, new Sealer(dir))
    expect(await sendPush({ ...ok, endpoint: "https://updater:8090/update" }, {}, vapid, "x", async () => (posted++, { status: 201 }))).toBe("failed")
    expect(posted).toBe(0)
  })
})
