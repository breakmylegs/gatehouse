// O41: CNW's updater uses only a manifest signed with the release key, naming a full commit and a proper version.
import crypto from "node:crypto"
import { describe, expect, it } from "vitest"
import { newer, verifyManifest } from "../src/updater.js"

describe("the CNW updater", () => {
  it("accepts only a signed manifest with a full commit and a version", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
    const pem = publicKey.export({ format: "pem", type: "spki" }).toString()
    const json = JSON.stringify({ version: "1.2.0", commit: "a".repeat(40) })
    const sig = crypto.sign(null, Buffer.from(json), privateKey).toString("base64")
    expect(verifyManifest(json, sig, pem)).toEqual({ version: "1.2.0", commit: "a".repeat(40) })
    expect(verifyManifest(json.replace("1.2.0", "9.9.9"), sig, pem)).toBeUndefined()
    const other = crypto.generateKeyPairSync("ed25519").privateKey
    expect(verifyManifest(json, crypto.sign(null, Buffer.from(json), other).toString("base64"), pem)).toBeUndefined()
    const short = JSON.stringify({ version: "1.2.0", commit: "abc" })
    expect(verifyManifest(short, crypto.sign(null, Buffer.from(short), privateKey).toString("base64"), pem)).toBeUndefined()
  })

  it("compares versions", () => {
    expect(newer("1.10.0", "1.9.9")).toBe(true)
    expect(newer("1.2.0", "1.2.0")).toBe(false)
    expect(newer("1.1.9", "1.2.0")).toBe(false)
  })
})
