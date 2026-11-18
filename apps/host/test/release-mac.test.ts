// Mac fork (18 Nov): what a Mac release is, for the Mac in-app updater: its fixed names, its parts, hashes that see a
// lost link or executable bit, the order of Mac versions, and a signed description that is checked before it is used.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  MAC_CHANNEL_TAG,
  MAC_PRODUCT,
  MAC_UPDATE_FILE,
  MAC_UPDATE_SIGNATURE,
  compareMacVersions,
  macPartOf,
  macPartTrees,
  macTag,
  verifyMacRelease,
} from "../src/update/release-mac.js"
import { PRODUCT, signRelease } from "../src/update/manifest.js"
import { UPDATE_FILE } from "../src/update/tree.js"

let root: string
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-release-mac-"))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe("a Mac release", () => {
  it("is found by names that never change, and none of them is Windows'", () => {
    expect([MAC_PRODUCT, MAC_UPDATE_FILE, MAC_UPDATE_SIGNATURE, MAC_CHANNEL_TAG]).toEqual([
      "gatehouse-mac",
      "update-mac.json",
      "update-mac.sig",
      "mac-channel",
    ])
    expect(MAC_PRODUCT).not.toBe(PRODUCT)
    expect(MAC_UPDATE_FILE).not.toBe(UPDATE_FILE)
    // Never a v<number> tag, which is how Windows' releases are named.
    expect(macTag("2.0.444+mac.3")).toBe("mac-v2.0.444-mac.3")
  })

  it("splits Codehouse.app into the program, the app, its packages and Node", () => {
    expect(macPartOf("Contents/MacOS/Codehouse")).toBe("program")
    expect(macPartOf("Contents/Info.plist")).toBe("program")
    expect(macPartOf("Contents/_CodeSignature/CodeResources")).toBe("program")
    expect(macPartOf("Contents/Resources/splash.png")).toBe("program")
    expect(macPartOf("Contents/Resources/app/apps/host/dist/main.js")).toBe("app")
    expect(macPartOf("Contents/Resources/app/node_modules/zod/index.js")).toBe("modules")
    expect(macPartOf("Contents/Resources/runtime/node")).toBe("runtime")
    expect(macPartOf("release.json")).toBeUndefined()
  })

  it.skipIf(process.platform === "win32")("has hashes that change when a link or an executable bit is lost", async () => {
    const app = path.join(root, "Codehouse.app")
    const mods = path.join(app, "Contents/Resources/app/node_modules/@gatehouse")
    fs.mkdirSync(mods, { recursive: true })
    fs.mkdirSync(path.join(app, "Contents/Resources/runtime"), { recursive: true })
    fs.mkdirSync(path.join(app, "Contents/Resources/app/packages/policy"), { recursive: true })
    const node = path.join(app, "Contents/Resources/runtime/node")
    fs.writeFileSync(node, "bin", { mode: 0o755 })
    fs.symlinkSync("../../packages/policy", path.join(mods, "policy"))
    const before = await macPartTrees(app)
    expect(before.modules.files).toBe(1)
    expect(before.modules.bytes).toBe("../../packages/policy".length)
    fs.chmodSync(node, 0o644)
    expect((await macPartTrees(app)).runtime.tree).not.toBe(before.runtime.tree)
    fs.chmodSync(node, 0o755)
    fs.rmSync(path.join(mods, "policy"))
    fs.symlinkSync("../../packages/other", path.join(mods, "policy"))
    expect((await macPartTrees(app)).modules.tree).not.toBe(before.modules.tree)
  })

  it("orders Mac versions by release, then Mac commits, a .dev build before its own number", () => {
    expect(compareMacVersions("2.0.444+mac.3", "2.0.444+mac.2")).toBeGreaterThan(0)
    expect(compareMacVersions("2.0.445+mac.0", "2.0.444+mac.9")).toBeGreaterThan(0)
    expect(compareMacVersions("2.0.444+mac.3", "2.0.444+mac.3")).toBe(0)
    expect(compareMacVersions("2.0.444+mac.3.dev", "2.0.444+mac.3")).toBeLessThan(0)
    expect(compareMacVersions("2.0.444+mac.4", "2.0.444+mac.3.dev")).toBeGreaterThan(0)
    expect(() => compareMacVersions("2.0.444", "2.0.444+mac.1")).toThrow()
  })
})

describe("a Mac release's signed description", () => {
  const key = crypto.generateKeyPairSync("ed25519")
  const pub = key.publicKey.export({ type: "spki", format: "pem" }).toString()
  const priv = key.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  const part = (name: string) => ({
    name,
    tree: "a".repeat(64),
    files: 1,
    bytes: 1,
    archive: `codeh-mac-2.0.444-mac.3-${name}.zip`,
    size: 9,
    sha256: "b".repeat(64),
  })
  const manifest = (over: Record<string, unknown> = {}) =>
    Buffer.from(
      JSON.stringify({
        format: 1,
        product: MAC_PRODUCT,
        version: "2.0.444+mac.3",
        arch: "arm64",
        notes: "",
        parts: ["program", "app", "modules", "runtime"].map(part),
        ...over,
      }),
    )
  const check = (bytes: Buffer, keys = [pub], arch = "arm64") => verifyMacRelease(bytes, signRelease(bytes, priv), keys, arch)

  it("is used only when its own key signed it, and is for this Mac's processor", () => {
    expect(check(manifest())).toMatchObject({ ok: true, manifest: { version: "2.0.444+mac.3" } })
    expect(check(manifest(), [])).toMatchObject({ ok: false, error: /not signed/ })
    const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString()
    expect(check(manifest(), [other])).toMatchObject({ ok: false, error: /not signed/ })
    expect(check(manifest(), [pub], "x64")).toMatchObject({ ok: false, error: /built for arm64/ })
    const signed = manifest()
    const tampered = Buffer.from(signed.toString().replace("mac.3", "mac.4"))
    expect(verifyMacRelease(tampered, signRelease(signed, priv), [pub], "arm64")).toMatchObject({ ok: false })
  })

  it("refuses Windows' product, a .dev build, a missing part and a newer layout", () => {
    expect(check(manifest({ product: PRODUCT }))).toMatchObject({ ok: false })
    expect(check(manifest({ version: "2.0.444+mac.3.dev" }))).toMatchObject({ ok: false })
    expect(check(manifest({ version: "2.0.444" }))).toMatchObject({ ok: false })
    expect(check(manifest({ parts: ["program", "app", "modules"].map(part) }))).toMatchObject({ ok: false })
    expect(check(manifest({ format: 2 }))).toMatchObject({ ok: false, error: /installed by hand/ })
  })
})
