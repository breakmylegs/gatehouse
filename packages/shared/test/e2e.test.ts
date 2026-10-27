import { describe, expect, it } from "vitest"
import {
  b64u,
  exportPublicKey,
  fingerprint,
  generateKeyPair,
  importPublicKey,
  open,
  openJson,
  seal,
  sealJson,
  unb64u,
} from "../src/e2e.js"
import { canonicalize } from "../src/canonical-json.js"
import { canonicalize as canonicalNode } from "../src/canonical.js"

describe("base64url", () => {
  it("round-trips every byte value and large buffers, without padding or unsafe characters", () => {
    const all = new Uint8Array(256).map((_, i) => i)
    expect(unb64u(b64u(all))).toEqual(all)
    const big = new Uint8Array(100_000).map((_, i) => (i * 7) % 256)
    expect(unb64u(b64u(big))).toEqual(big)
    expect(b64u(new Uint8Array([251, 255, 254]))).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(b64u(new Uint8Array([1]))).not.toContain("=")
  })
})

describe("seal and open", () => {
  it("delivers the plaintext to the holder of the private key and nobody else", async () => {
    const phone = await generateKeyPair(false)
    const other = await generateKeyPair(false)
    const sealed = await sealJson(
      { command: "rm -rf build", note: "unicode: 日本語 🚀" },
      phone.publicKey,
      "req-1",
    )
    expect(JSON.stringify(sealed)).not.toContain("rm -rf")
    expect(await openJson(sealed, phone.privateKey, "req-1")).toEqual({
      command: "rm -rf build",
      note: "unicode: 日本語 🚀",
    })
    await expect(open(sealed, other.privateKey, "req-1")).rejects.toThrow()
  })

  it("binds the ciphertext to its request id", async () => {
    const phone = await generateKeyPair(false)
    const sealed = await sealJson({ a: 1 }, phone.publicKey, "req-1")
    await expect(open(sealed, phone.privateKey, "req-2")).rejects.toThrow()
  })

  it("rejects any tampered field", async () => {
    const phone = await generateKeyPair(false)
    const sealed = await seal(
      new TextEncoder().encode("hello") as Uint8Array<ArrayBuffer>,
      phone.publicKey,
      "r",
    )
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1)
    for (const field of ["ct", "iv", "salt"] as const)
      await expect(
        open({ ...sealed, [field]: flip(sealed[field]) }, phone.privateKey, "r"),
      ).rejects.toThrow()
    const swapped = await generateKeyPair(false)
    await expect(
      open({ ...sealed, epk: await exportPublicKey(swapped.publicKey) }, phone.privateKey, "r"),
    ).rejects.toThrow()
    await expect(open({ ...sealed, v: 2 as 1 }, phone.privateKey, "r")).rejects.toThrow(/version/)
  })

  it("never reuses nonce, salt or ephemeral key", async () => {
    const phone = await generateKeyPair(false)
    const a = await sealJson("same", phone.publicKey, "r")
    const b = await sealJson("same", phone.publicKey, "r")
    expect(a.iv).not.toBe(b.iv)
    expect(a.salt).not.toBe(b.salt)
    expect(a.epk).not.toBe(b.epk)
    expect(a.ct).not.toBe(b.ct)
  })

  it("keeps the phone's private key non-extractable", async () => {
    const phone = await generateKeyPair(false)
    await expect(globalThis.crypto.subtle.exportKey("pkcs8", phone.privateKey)).rejects.toThrow()
  })

  it("only accepts an uncompressed P-256 public key", async () => {
    const k = await generateKeyPair(false)
    const raw = await exportPublicKey(k.publicKey)
    expect(await importPublicKey(raw)).toBeTruthy()
    await expect(importPublicKey(b64u(new Uint8Array(33)))).rejects.toThrow()
    await expect(importPublicKey(b64u(new Uint8Array(65)))).rejects.toThrow()
  })

  it("handles an empty and a 1 MB plaintext", async () => {
    const k = await generateKeyPair(false)
    expect(
      (await open(await seal(new Uint8Array(0), k.publicKey, "r"), k.privateKey, "r")).length,
    ).toBe(0)
    const big = new Uint8Array(1 << 20).map((_, i) => i % 251)
    expect(await open(await seal(big, k.publicKey, "r"), k.privateKey, "r")).toEqual(big)
  })
})

describe("fingerprint", () => {
  it("is six digits, the same on both sides, and changes if any part changes", async () => {
    const parts = { hostPublicKey: "H", phonePublicKey: "P", credentialId: "C" }
    const f = await fingerprint(parts)
    expect(f).toMatch(/^\d{6}$/)
    expect(await fingerprint({ ...parts })).toBe(f)
    expect(
      new Set([
        f,
        await fingerprint({ ...parts, hostPublicKey: "H2" }),
        await fingerprint({ ...parts, phonePublicKey: "P2" }),
        await fingerprint({ ...parts, credentialId: "C2" }),
      ]).size,
    ).toBe(4)
  })
})

describe("canonical json in the browser-safe module", () => {
  it("is the same function the Node side uses", () => {
    const v = { b: [1, { z: 1, a: undefined, y: "é" }], a: null }
    expect(canonicalize(v)).toBe(canonicalNode(v))
    expect(canonicalize(v)).toBe('{"a":null,"b":[1,{"y":"é","z":1}]}')
  })
})
