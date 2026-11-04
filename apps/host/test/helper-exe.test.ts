// Codehouse-Helper.exe (owner, 4 Nov: "Why do I need powershell at all?"): DPAPI and the Windows file windows without
// PowerShell. Built from packaging/Helper.cs with the compiler that ships with Windows and run for real.
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  DpapiProtector,
  HelperProtector,
  PlainProtector,
  sealerFor,
} from "../src/relay/protector.js"
import { findCodehouseHelper } from "../src/win-helper.js"

const csc = [
  `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
  `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
].find((p) => fs.existsSync(p))
const REPO = path.resolve(import.meta.dirname, "../../..")
let dir: string
let exe: string | undefined
const text = (b: Uint8Array) => new TextDecoder().decode(b)
const bytes = (s: string) => new TextEncoder().encode(s)

beforeAll(() => {
  if (!csc) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-helper-"))
  exe = findCodehouseHelper({
    installDir: undefined,
    repoRoot: REPO,
    dataDir: dir,
    log: () => undefined,
  })
}, 120_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe("which protection Codehouse uses", () => {
  it("is the helper when there is one, PowerShell only when there is not, and looks only when it must", () => {
    let looked = 0
    const helper = (exe: string | undefined) => () => {
      looked++
      return exe
    }
    expect(
      sealerFor({ helper: helper("C:\\x\\Codehouse-Helper.exe"), platform: "win32" }),
    ).toBeInstanceOf(HelperProtector)
    expect(sealerFor({ helper: helper(undefined), platform: "win32" })).toBeInstanceOf(
      DpapiProtector,
    )
    expect(sealerFor({ helper: helper(undefined), platform: "darwin" })).toBeInstanceOf(
      PlainProtector,
    )
    expect(looked).toBe(3)
    const given = new PlainProtector()
    expect(sealerFor({ given, helper: helper("C:\\x\\Codehouse-Helper.exe") })).toBe(given)
    expect(looked).toBe(3)
  })
})

describe.skipIf(!csc)("Codehouse-Helper.exe", () => {
  it("is built from its source into the data folder, once", () => {
    expect(exe).toBe(path.join(dir, "bin", "Codehouse-Helper.exe"))
    const built = fs.statSync(exe!).mtimeMs
    findCodehouseHelper({
      installDir: undefined,
      repoRoot: REPO,
      dataDir: dir,
      log: () => undefined,
    })
    expect(fs.statSync(exe!).mtimeMs).toBe(built)
  })

  it("seals with DPAPI with no PowerShell anywhere on the PATH", () => {
    const run = (flag: string, input: string) =>
      spawnSync(exe!, [flag], {
        input,
        encoding: "utf8",
        env: { SystemRoot: process.env.SystemRoot },
        windowsHide: true,
      })
    const sealed = run("--protect", Buffer.from("sign-in").toString("base64"))
    expect(sealed.status).toBe(0)
    expect(sealed.stdout).not.toContain(Buffer.from("sign-in").toString("base64"))
    const opened = run("--unprotect", sealed.stdout)
    expect(Buffer.from(opened.stdout, "base64").toString()).toBe("sign-in")
  })

  it("opens what PowerShell sealed before it, and the other way round, so no secret is lost", async () => {
    const helper = new HelperProtector(exe!)
    const old = new DpapiProtector()
    expect(text(await helper.unprotect(await old.protect(bytes("phone key"))))).toBe("phone key")
    expect(text(await old.unprotect(await helper.protect(bytes("ntfy password"))))).toBe(
      "ntfy password",
    )
  }, 60_000)

  it("fails, never passing the bytes through, on bad input or misuse", async () => {
    await expect(new HelperProtector(exe!).unprotect(bytes("not sealed at all"))).rejects.toThrow(
      /DPAPI unprotect failed/,
    )
    await expect(
      new HelperProtector(path.join(dir, "missing.exe")).protect(bytes("x")),
    ).rejects.toThrow(/DPAPI protect failed/)
    expect(spawnSync(exe!, ["--elsewhere"], { windowsHide: true }).status).toBe(2)
    expect(() => execFileSync(exe!, [], { windowsHide: true, stdio: "pipe" })).toThrow()
  })
})
