// Mac fork (18 Nov): publishing a Mac release (scripts/release-mac.ts). The key is made once and only its public half is
// shown; a release's parts unpack, as a Mac copy unpacks them, to exactly the signed hashes; it is never GitHub's Latest,
// and if anything made a Mac release Latest, the newest Windows release is put back.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  keepWindowsLatest,
  macArchive,
  makeMacRelease,
  newMacKey,
  publicOf,
  refreshChannel,
} from "../../../scripts/release-mac.js"
import type { Ran } from "../../../scripts/release-upload.js"
import { MAC_PART_NAMES, macPartOf, macPartTrees, verifyMacRelease } from "../src/update/release-mac.js"
import { extractZip } from "../src/update/zip.js"

let dir: string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-release-mac-pub-"))
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the Mac release key", () => {
  it("is made once, readable only by you, and only its public half is given back", () => {
    const file = path.join(dir, "keys", "mac-release-key.pem")
    const pub = newMacKey(file)
    expect(pub).toMatch(/^-----BEGIN PUBLIC KEY-----/)
    expect(pub).not.toMatch(/PRIVATE/)
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(publicOf(fs.readFileSync(file, "utf8"))).toBe(pub)
    expect(() => newMacKey(file)).toThrow(/already exists/)
    expect(publicOf(fs.readFileSync(file, "utf8"))).toBe(pub)
  })
})

describe.skipIf(process.platform === "win32")("a Mac release's files", () => {
  const app = () => {
    const a = path.join(dir, "Codehouse.app")
    const c = (rel: string, text: string, mode = 0o644) => {
      fs.mkdirSync(path.dirname(path.join(a, rel)), { recursive: true })
      fs.writeFileSync(path.join(a, rel), text, { mode })
    }
    c("Contents/Info.plist", "<plist/>")
    c("Contents/MacOS/Codehouse", "program", 0o755)
    c("Contents/Resources/app/packages/policy/index.js", "policy")
    c("Contents/Resources/app/node_modules/zod/index.js", "zod")
    c("Contents/Resources/runtime/node", "node", 0o755)
    fs.mkdirSync(path.join(a, "Contents/Resources/app/node_modules/@gatehouse"), { recursive: true })
    fs.symlinkSync("../../packages/policy", path.join(a, "Contents/Resources/app/node_modules/@gatehouse/policy"))
    return a
  }

  it("unpack, as a Mac copy unpacks them, to exactly the signed hashes", async () => {
    const keyFile = path.join(dir, "k2.pem")
    const pub = newMacKey(keyFile)
    const src = app()
    const out = path.join(dir, "out")
    const { files, manifest } = await makeMacRelease({
      app: src, out, version: "2.0.444+mac.3", arch: "arm64", notes: "- a change", privatePem: fs.readFileSync(keyFile, "utf8"), keys: [pub],
    })
    expect(files.map((f) => path.basename(f))).toEqual([
      ...MAC_PART_NAMES.map((n) => macArchive("2.0.444+mac.3", n)),
      "update-mac.json",
      "update-mac.sig",
    ])
    expect(macArchive("2.0.444+mac.3", "app")).toBe("codeh-mac-2.0.444-mac.3-app.zip")
    const bytes = fs.readFileSync(path.join(out, "update-mac.json"))
    expect(verifyMacRelease(bytes, fs.readFileSync(path.join(out, "update-mac.sig"), "utf8"), [pub], "arm64").ok).toBe(true)
    const back = path.join(dir, "back", "Codehouse.app")
    for (const p of manifest.parts)
      await extractZip(path.join(out, p.archive), back, p.name, { files: p.files, bytes: p.bytes }, { unix: true, of: macPartOf })
    const trees = await macPartTrees(back)
    for (const p of manifest.parts) expect(trees[p.name].tree, p.name).toBe(p.tree)
    expect(fs.statSync(path.join(back, "Contents/MacOS/Codehouse")).mode & 0o111).not.toBe(0)
    expect(fs.readlinkSync(path.join(back, "Contents/Resources/app/node_modules/@gatehouse/policy"))).toBe("../../packages/policy")
  })

  it("is refused for a build with changes not committed, and for a key the app does not trust", async () => {
    const keyFile = path.join(dir, "k3.pem")
    const pub = newMacKey(keyFile)
    const base = { app: path.join(dir, "Codehouse.app"), out: path.join(dir, "out3"), arch: "arm64" as const, notes: "", privatePem: fs.readFileSync(keyFile, "utf8") }
    await expect(makeMacRelease({ ...base, version: "2.0.444+mac.3.dev", keys: [pub] })).rejects.toThrow(/not a Mac release version/)
    await expect(makeMacRelease({ ...base, version: "2.0.444+mac.3", keys: [] })).rejects.toThrow(/not signed/)
  })
})

/** A fake gh: answers by the command, records every call. */
function gh(answers: Record<string, Ran>) {
  const calls: string[][] = []
  const run = (_cmd: string, args: string[]): Ran => {
    calls.push(args)
    const key = Object.keys(answers).find((k) => args.join(" ").startsWith(k))
    return key ? answers[key]! : { status: 0, stdout: "", stderr: "" }
  }
  return { run, calls }
}
const ok = (stdout = ""): Ran => ({ status: 0, stdout, stderr: "" })

describe("GitHub's Latest, kept for Windows", () => {
  it("is left alone while it is a Windows release", () => {
    const g = gh({ "api repos/o/r/releases/latest": ok("v2.0.444\n") })
    expect(keepWindowsLatest(g.run, "o/r")).toMatch(/still v2\.0\.444/)
    expect(g.calls.some((c) => c[1] === "edit")).toBe(false)
  })

  it("is put back on the newest Windows release if a Mac release became Latest", () => {
    const list = [
      { tagName: "mac-v2.0.444-mac.3", isDraft: false, isPrerelease: false },
      { tagName: "v2.0.99", isDraft: false, isPrerelease: false },
      { tagName: "v2.0.444", isDraft: false, isPrerelease: false },
      { tagName: "v2.0.445", isDraft: true, isPrerelease: false },
      { tagName: "mac-channel", isDraft: false, isPrerelease: false },
    ]
    const g = gh({ "api repos/o/r/releases/latest": ok("mac-v2.0.444-mac.3\n"), "release list": ok(JSON.stringify(list)) })
    expect(keepWindowsLatest(g.run, "o/r")).toMatch(/v2\.0\.444 is Latest again/)
    expect(g.calls.find((c) => c[1] === "edit")).toEqual(["release", "edit", "v2.0.444", "--repo", "o/r", "--latest"])
  })

  it("says so when there is no Windows release to put back", () => {
    const g = gh({ "api repos/o/r/releases/latest": ok("mac-channel"), "release list": ok("[]") })
    expect(() => keepWindowsLatest(g.run, "o/r")).toThrow(/no Windows release/)
  })
})

describe("the mac-channel release", () => {
  it("is made never Latest the first time, and its two files are replaced each time", () => {
    const f1 = path.join(dir, "update-mac.json")
    const f2 = path.join(dir, "update-mac.sig")
    fs.writeFileSync(f1, "{}")
    fs.writeFileSync(f2, "sig")
    let made = false
    const calls: string[][] = []
    const run = (_c: string, args: string[]): Ran => {
      calls.push(args)
      if (args[1] === "view")
        return made
          ? ok(JSON.stringify({ isDraft: false, assets: [{ name: "update-mac.json", size: 2 }, { name: "update-mac.sig", size: 3 }] }))
          : { status: 1, stdout: "", stderr: "release not found" }
      if (args[1] === "create") made = true
      return ok()
    }
    refreshChannel(run, "o/r", [f1, f2], "abc")
    const create = calls.find((c) => c[1] === "create")!
    expect(create).toContain("--latest=false")
    expect(create).not.toContain("--latest")
    expect(calls.filter((c) => c[1] === "upload").map((c) => c.slice(2, 4).concat(c.slice(-1)))).toEqual([
      ["mac-channel", f1, "--clobber"],
      ["mac-channel", f2, "--clobber"],
    ])
  })
})
