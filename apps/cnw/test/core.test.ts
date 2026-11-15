// O41, Codehouse Neighbourhood Watch: its store, passwords, IP allow list and pairing.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { allowed, parseRange, type Range } from "../src/allowlist.js"
import { checkPublicKey, newCode, redeem, verifyChallenge } from "../src/pairing.js"
import { hashPassword, verifyPassword } from "../src/passwords.js"
import { JsonStore } from "../src/store.js"

describe("the store", () => {
  it("writes atomically and keeps what it does not know", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-store-"))
    try {
      fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify({ users: [], future: { kept: true } }))
      const s = new JsonStore<{ users: string[] }>(dir, "users", () => ({ users: [] }))
      s.update((c) => ({ ...c, users: ["ana"] }))
      const raw = JSON.parse(fs.readFileSync(path.join(dir, "users.json"), "utf8"))
      expect(raw).toEqual({ users: ["ana"], future: { kept: true } })
      expect(fs.readdirSync(dir)).toEqual(["users.json"])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("passwords", () => {
  it("hashes with scrypt, verifies, and refuses a short one", async () => {
    const h = await hashPassword("correct horse battery")
    expect(h.startsWith("scrypt$")).toBe(true)
    expect(await verifyPassword("correct horse battery", h)).toBe(true)
    expect(await verifyPassword("correct horse batterz", h)).toBe(false)
    expect(await verifyPassword("x", "not-a-hash")).toBe(false)
    await expect(hashPassword("short")).rejects.toThrow(/12 characters/)
  })
})

describe("the IP allow list", () => {
  it("matches ranges, IPv4 inside IPv6 included, and refuses ranges that are far too wide", () => {
    const ranges = [parseRange("192.168.1.0/24"), parseRange("fd00::/64")] as Range[]
    expect(allowed("192.168.1.40", ranges)).toBe(true)
    expect(allowed("::ffff:192.168.1.40", ranges)).toBe(true)
    expect(allowed("192.168.2.40", ranges)).toBe(false)
    expect(allowed("fd00::1", ranges)).toBe(true)
    expect(allowed("fd01::1", ranges)).toBe(false)
    for (const wide of ["0.0.0.0/0", "::/0", "10.0.0.0/7", "2001::/15"]) expect(typeof parseRange(wide), wide).toBe("string")
    expect(typeof parseRange("not-an-ip")).toBe("string")
    expect(parseRange("10.1.2.3")).toEqual({ base: "10.1.2.3", bits: 32, v6: false })
  })
})

describe("pairing a computer", () => {
  it("redeems a code once, before it expires, and checks the computer's signature", () => {
    const { code, pending } = newCode("Laptop", 0)
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(redeem(code, [pending], 11 * 60_000).match).toBeUndefined()
    const first = redeem(code.toLowerCase().replace("-", " "), [pending], 60_000)
    expect(first.match?.label).toBe("Laptop")
    expect(redeem(code, first.pending, 60_000).match).toBeUndefined()

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
    const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64url")
    expect(checkPublicKey(pub)).toBe(pub)
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ format: "der", type: "spki" }).toString("base64url")
    expect(checkPublicKey(rsa)).toBeUndefined()
    const computer = { id: "c1", label: "Laptop", publicKey: pub, pairedAt: "" }
    const sig = crypto.sign(null, Buffer.from("challenge-1"), privateKey).toString("base64url")
    expect(verifyChallenge(computer, "challenge-1", sig)).toBe(true)
    expect(verifyChallenge(computer, "challenge-2", sig)).toBe(false)
  })
})
