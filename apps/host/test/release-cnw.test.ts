// O41: npm run release:cnw signs CNW's update so the updater accepts it, refuses a key CNW would not trust, and never
// lets the CNW release become the repository's latest, which is where Codehouse's own update looks.
import crypto from "node:crypto"
import { describe, expect, it } from "vitest"
import { verifyManifest } from "../../cnw/src/updater.js"
import { CNW_TAG, ghCommands, manifestJson, signManifest } from "../../../scripts/release-cnw.js"

describe("release:cnw (O41)", () => {
  it("signs a manifest the updater accepts, and refuses a key CNW does not trust", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
    const pub = publicKey.export({ format: "pem", type: "spki" }).toString()
    const priv = privateKey.export({ format: "pem", type: "pkcs8" }).toString()
    const json = manifestJson({ version: "1.0.0", commit: "b".repeat(40) })
    const sig = signManifest(json, priv, [pub])
    expect(verifyManifest(json, sig, pub)).toEqual({ version: "1.0.0", commit: "b".repeat(40) })
    // The built-in key is not this one, so nothing would be uploaded.
    expect(() => signManifest(json, priv)).toThrow(/does not verify/)
  })

  it("publishes cnw-latest only as a pre-release never marked latest, so Codehouse's update is untouched", () => {
    for (const exists of [false, true]) {
      const cmds = ghCommands(exists, ["a.json", "a.sig"], "1.0.0")
      const last = cmds.at(-1)!
      expect(last).toContain(CNW_TAG)
      expect(last).toContain("--prerelease")
      expect(last).toContain("--latest=false")
      expect(cmds.flat()).not.toContain("--latest")
    }
  })
})
