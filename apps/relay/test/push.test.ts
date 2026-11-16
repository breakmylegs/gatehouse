// A push that does not get through says why (16 Nov): the push service's status, "unreachable" when it did not answer,
// or "gone" when the phone's notifications are no longer registered. It used to be silent, so a phone that stopped
// hearing gave no reason. The push service is not called: web-push is stood in for.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const answer = vi.hoisted(() => ({ next: undefined as unknown }))
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
    sendNotification: vi.fn(async () => {
      if (answer.next) throw answer.next
      return { statusCode: 201 }
    }),
  },
}))
const { Store } = await import("../src/db.js")
const { WebPushSender } = await import("../src/push.js")

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-relay-push-"))
const sender = new WebPushSender(new Store(dir), "https://relay.example.test")
const SUB = JSON.stringify({ endpoint: "https://web.push.apple.com/x", keys: { p256dh: "a", auth: "b" } })
beforeEach(() => (answer.next = undefined))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("a push to the phone", () => {
  it("says the push service's answer when it refuses, gone when the phone's subscription has ended", async () => {
    expect(await sender.send(SUB, { t: "request", id: "r1" }, true)).toBe("ok")
    answer.next = Object.assign(new Error("Forbidden"), { statusCode: 403 })
    expect(await sender.send(SUB, { t: "request" }, true)).toBe("error 403")
    answer.next = Object.assign(new Error("Gone"), { statusCode: 410 })
    expect(await sender.send(SUB, { t: "request" }, true)).toBe("gone")
    answer.next = new Error("getaddrinfo ENOTFOUND")
    expect(await sender.send(SUB, { t: "request" }, true)).toBe("error unreachable")
  })
})
