// D-063 (safe variant): NuGet package provenance, offline. A new NuGet package whose .nupkg on this computer carries
// no signature escalates as nuget-unsigned; a signed one, or one not downloaded yet, adds nothing here.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PolicyEngine } from "../src/engine.js"
import { loadPolicy } from "../src/loader.js"
import { NUGET_UNSIGNED, nugetSignatureFindings, nupkgSigned, zipEntries } from "../src/nuget-signature.js"
import { fwd, makeFixture, SEED_RULES, type Fixture } from "./helpers.js"

/** A small zip archive of stored entries, as a .nupkg is laid out. */
function zip(file: string, entries: Record<string, string>) {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text)
    const n = Buffer.from(name)
    const crc = zlib.crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(n.length, 26)
    locals.push(local, n, data)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(data.length, 20)
    c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, n)
    offset += 30 + n.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]))
}

let home: string
let fx: Fixture
let savedHome: string | undefined
beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "gh-nuget-"))
  zip(path.join(home, ".nuget", "packages", "signedlib", "1.2.0", "signedlib.1.2.0.nupkg"), { "signedlib.nuspec": "<package/>", ".signature.p7s": "p7s" })
  zip(path.join(home, ".nuget", "packages", "loosepkg", "0.1.0", "loosepkg.0.1.0.nupkg"), { "loosepkg.nuspec": "<package/>", "lib/net8.0/x.dll": "x" })
  fx = makeFixture()
  savedHome = process.env.USERPROFILE
})
afterAll(() => {
  process.env.USERPROFILE = savedHome
  fx.dispose()
  fs.rmSync(home, { recursive: true, force: true })
})

describe("NuGet package provenance (D-063)", () => {
  it("reads a package's own directory to tell a signed one from an unsigned one", () => {
    expect(zipEntries(path.join(home, ".nuget", "packages", "loosepkg", "0.1.0", "loosepkg.0.1.0.nupkg"))).toEqual(["loosepkg.nuspec", "lib/net8.0/x.dll"])
    expect(nupkgSigned(path.join(home, ".nuget", "packages", "signedlib", "1.2.0", "signedlib.1.2.0.nupkg"))).toBe(true)
    expect(nupkgSigned(path.join(home, ".nuget", "packages", "loosepkg", "0.1.0", "loosepkg.0.1.0.nupkg"))).toBe(false)
    expect(nupkgSigned(path.join(home, "nothing.nupkg"))).toBeUndefined()
    const nuget = (name: string) => ({ ecosystem: "nuget" as const, name })
    expect(nugetSignatureFindings([nuget("SignedLib"), nuget("LoosePkg"), nuget("NotDownloaded")], home).map((f) => [f.ruleId, f.dependency])).toEqual([[NUGET_UNSIGNED, "nuget:LoosePkg"]])
  })

  it("escalates adding an unsigned NuGet package, and says so on the card", async () => {
    process.env.USERPROFILE = home
    const policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)] })
    const engine = new PolicyEngine({ getPolicy: () => policy })
    const v = await engine.evaluate({ toolName: "Bash", input: { command: "dotnet add package LoosePkg" } }, { cwd: fwd(fx.ws) })
    expect(v.outcome).toBe("escalate")
    expect(v.reason).toMatch(/carries no signature/)
  })
})
