import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { Store } from "../src/db.js"
import { WebPushSender } from "../src/push.js"
import { buildRelay } from "../src/server.js"

const dirs: string[] = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gh-rot-"))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

describe("rotating secrets", () => {
  it("a rotated device token replaces the old one at once, for that device only", async () => {
    const dir = tmp()
    const store = new Store(dir)
    const relay = await buildRelay({
      publicUrl: "https://x.example.test",
      store,
      push: new WebPushSender(store, "https://x.example.test"),
      enrolFile: path.join(dir, "enrol.txt"),
      anonymousLimit: 1000,
    })
    const enrol = async (name: string) => {
      const t = fs.readFileSync(path.join(dir, "enrol.txt"), "utf8").trim()
      const r = await relay.app.inject({
        method: "POST",
        url: "/api/device/enroll",
        payload: { enrolToken: t, name },
      })
      return r.json() as { token: string }
    }
    const a = await enrol("a")
    const b = await enrol("b")
    const call = (token: string, method: "GET" | "POST", url: string) =>
      relay.app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
        ...(method === "POST" ? { payload: {} } : {}),
      })
    expect((await call("x".repeat(30), "POST", "/api/device/rotate-token")).statusCode).toBe(401)
    const rotated = (await call(a.token, "POST", "/api/device/rotate-token")).json() as {
      token: string
    }
    expect(rotated.token).not.toBe(a.token)
    expect((await call(a.token, "GET", "/api/device/phones")).statusCode).toBe(401)
    expect((await call(rotated.token, "GET", "/api/device/phones")).statusCode).toBe(200)
    expect((await call(b.token, "GET", "/api/device/phones")).statusCode).toBe(200)
    await relay.close()
    store.close()
  })

  it("new push keys differ from the old, and the old ones are really gone", () => {
    const store = new Store(tmp())
    const a = new WebPushSender(store, "https://x.example.test").publicKey()
    expect(new WebPushSender(store, "https://x.example.test").publicKey()).toBe(a)
    store.kvDelete("vapid")
    expect(store.kvGet("vapid")).toBeUndefined()
    expect(new WebPushSender(store, "https://x.example.test").publicKey()).not.toBe(a)
    store.close()
  })
})
