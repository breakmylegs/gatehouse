import { describe, expect, it } from "vitest"
import {
  KeychainProtector,
  PlainProtector,
  platformProtector,
  DpapiProtector,
  type SecurityRunner,
} from "../src/relay/protector.js"

/**
 * A stand-in for /usr/bin/security with one login Keychain in memory. Like the real one, an add without -U never
 * overwrites an item that is already there, and a missing item exits 44.
 */
function fakeKeychain(o: { readCode?: number } = {}) {
  const items = new Map<string, string>()
  const calls: Array<{ args: string[]; stdin?: string }> = []
  const run: SecurityRunner = async (args, stdin) => {
    calls.push({ args, ...(stdin !== undefined ? { stdin } : {}) })
    if (args[0] === "find-generic-password") {
      if (o.readCode !== undefined) return { code: o.readCode, stdout: "" }
      const v = items.get(`${args[2]}/${args[4]}`)
      return v === undefined ? { code: 44, stdout: "" } : { code: 0, stdout: `${v}\n` }
    }
    if (args[0] === "-i") {
      const m = /^add-generic-password -s (\S+) -a (\S+) -w (\S+)\n$/.exec(stdin ?? "")
      if (m && !items.has(`${m[1]}/${m[2]}`)) items.set(`${m[1]}/${m[2]}`, m[3]!)
      return { code: 0, stdout: "" }
    }
    return { code: 1, stdout: "" }
  }
  return { run, items, calls }
}

const secret = new TextEncoder().encode("relay-device-token-123")

describe("the Mac Keychain protector", () => {
  it("seals so the secret is not on disk in the clear, and opens what it sealed", async () => {
    const kc = fakeKeychain()
    const p = new KeychainProtector(kc.run)
    const sealed = await p.protect(secret)
    expect(Buffer.from(sealed).includes(Buffer.from("relay-device-token"))).toBe(false)
    expect(new TextDecoder().decode(await p.unprotect(sealed))).toBe("relay-device-token-123")
    // A second Host start reads the same key from the Keychain and opens it too.
    expect(new TextDecoder().decode(await new KeychainProtector(kc.run).unprotect(sealed))).toBe(
      "relay-device-token-123",
    )
  })

  it("never puts the key in a command's arguments, where the process list would show it", async () => {
    const kc = fakeKeychain()
    await new KeychainProtector(kc.run).protect(secret)
    const key = [...kc.items.values()][0]!
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    for (const c of kc.calls) expect(c.args.join(" ")).not.toContain(key)
  })

  it("keeps the first key when two make one at once, so nothing either sealed is stranded", async () => {
    const kc = fakeKeychain()
    const a = new KeychainProtector(kc.run)
    const b = new KeychainProtector(kc.run)
    const [sa, sb] = await Promise.all([a.protect(secret), b.protect(secret)])
    expect(kc.items.size).toBe(1)
    await expect(b.unprotect(sa)).resolves.toEqual(secret)
    await expect(a.unprotect(sb)).resolves.toEqual(secret)
  })

  it("refuses, and makes no new key, when the Keychain cannot be read", async () => {
    const kc = fakeKeychain({ readCode: 51 })
    await expect(new KeychainProtector(kc.run).protect(secret)).rejects.toThrow(/Keychain read failed/)
    expect(kc.calls.some((c) => c.args[0] === "-i")).toBe(false)
  })

  it("refuses an item that is not a key rather than replacing it", async () => {
    const kc = fakeKeychain()
    kc.items.set("Codehouse/sealing-key", "not-a-key")
    await expect(new KeychainProtector(kc.run).protect(secret)).rejects.toThrow(/not a Codehouse key/)
    expect(kc.items.get("Codehouse/sealing-key")).toBe("not-a-key")
  })

  it("refuses a sealed file that was changed, or sealed some other way", async () => {
    const kc = fakeKeychain()
    const p = new KeychainProtector(kc.run)
    const sealed = Buffer.from(await p.protect(secret))
    sealed[sealed.length - 1]! ^= 1
    await expect(p.unprotect(sealed)).rejects.toThrow()
    await expect(p.unprotect(await new PlainProtector().protect(secret))).rejects.toThrow(
      /not protected by this protector/,
    )
  })

  it("is the protector on a Mac, DPAPI on Windows, and one shared Keychain protector per Host", () => {
    expect(platformProtector("darwin")).toBeInstanceOf(KeychainProtector)
    expect(platformProtector("darwin")).toBe(platformProtector("darwin"))
    expect(platformProtector("win32")).toBeInstanceOf(DpapiProtector)
  })
})
