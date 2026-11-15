// O41: pairing Codehouse with Neighbourhood Watch: https only, no credentials in the address, the certificate pinned
// first, the private key sealed only once CNW accepted the code, and CNW's refusal said plainly.
import { describe, expect, it } from "vitest"
import { checkUrl, pair } from "../src/cnw/pairing.js"

describe("pairing with Neighbourhood Watch (O41)", () => {
  it("takes only an https address without a name or password in it", () => {
    expect(checkUrl("https://cnw.home.arpa/some/page").origin).toBe("https://cnw.home.arpa")
    expect(() => checkUrl("http://cnw.home.arpa")).toThrow(/https/)
    expect(() => checkUrl("https://me:pw@cnw.home.arpa")).toThrow(/name and password/)
    expect(() => checkUrl("not a url")).toThrow(/not an address/)
  })

  it("pins the certificate, sends the code and public key over it, and seals the key only when accepted", async () => {
    const sealed: Buffer[] = []
    const sent: Array<{ url: string; body: Record<string, unknown>; pin: string }> = []
    const p = await pair("https://cnw.home.arpa", " K7M2-9QXP ", "Laptop", {
      seal: async (k) => void sealed.push(k),
      fingerprint: async () => "ab".repeat(32),
      post: async (url, body, pin) => (sent.push({ url: url.toString(), body: body as Record<string, unknown>, pin }), { status: 200, json: { computer: "c-1" } }),
    })
    expect(p).toEqual({ url: "https://cnw.home.arpa", computerId: "c-1", certSha256: "ab".repeat(32) })
    expect(sent[0]).toMatchObject({ url: "https://cnw.home.arpa/agent/pair", pin: "ab".repeat(32), body: { code: "K7M2-9QXP", label: "Laptop" } })
    expect(typeof sent[0]!.body.publicKey).toBe("string")
    expect(sealed).toHaveLength(1)

    await expect(
      pair("https://cnw.home.arpa", "bad", "Laptop", {
        seal: async (k) => void sealed.push(k),
        fingerprint: async () => "cd".repeat(32),
        post: async () => ({ status: 403, json: { error: "That code is not right, or it has expired." } }),
      }),
    ).rejects.toThrow(/not right/)
    expect(sealed).toHaveLength(1)
  })
})
