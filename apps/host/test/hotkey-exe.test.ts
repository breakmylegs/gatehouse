// W1-15: the quick prompt's shortcut, built from packaging/Hotkey.cs with the compiler that ships with Windows and
// run for real. The text you type is read the way Windows wants it, and a shortcut another program holds gets three
// free alternatives.
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const REPO = path.resolve(import.meta.dirname, "../../..")
const csc = [
  `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
  `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
].find((p) => fs.existsSync(p))
let dir: string
let exe: string
const run = (...args: string[]) => execFileSync(exe, args, { windowsHide: true }).toString().trim()

beforeAll(() => {
  if (!csc) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-hotkey-"))
  exe = path.join(dir, "Hotkey.exe")
  execFileSync(csc, [
    "/nologo",
    "/target:exe",
    "/define:HOTKEY_CLI",
    `/out:${exe}`,
    path.join(REPO, "packaging", "Hotkey.cs"),
  ])
}, 120_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!csc)("the quick prompt's shortcut", () => {
  it("reads the text in any case and order, and writes it back the one way", () => {
    expect(JSON.parse(run("--parse", "Ctrl+Alt+Space"))).toEqual({
      ok: true,
      text: "Ctrl+Alt+Space",
      mods: 3,
      vk: 0x20,
    })
    expect(JSON.parse(run("--parse", " space + alt + control "))).toMatchObject({
      text: "Ctrl+Alt+Space",
    })
    expect(JSON.parse(run("--parse", "Win+Shift+f12"))).toMatchObject({
      text: "Shift+Win+F12",
      vk: 0x7b,
    })
    expect(JSON.parse(run("--parse", "Ctrl+Alt+K"))).toMatchObject({ mods: 3, vk: 0x4b })
  })

  it("says why a shortcut cannot be used", () => {
    const why = (t: string) => (JSON.parse(run("--parse", t)) as { error?: string }).error
    expect(why("Shift+A")).toMatch(/Ctrl, Alt or Win/)
    expect(why("Ctrl+Alt")).toMatch(/Add a key/)
    expect(why("Ctrl+Ctrl+A")).toMatch(/twice/)
    expect(why("Ctrl+A+B")).toMatch(/one key/)
    expect(why("Ctrl+Tab")).toMatch(/not a key/)
    expect(why("Ctrl+F25")).toMatch(/not a key/)
  })

  it("offers three alternatives that are free, nearest first", () => {
    expect(run("--alternatives", "Ctrl+Alt+Space").split(/\r?\n/)).toEqual([
      "Ctrl+Alt+Shift+Space",
      "Ctrl+Shift+Space",
      "Alt+Shift+Space",
    ])
    const taken = "Ctrl+Alt+Shift+Space,Ctrl+Shift+Space"
    expect(run("--alternatives", "Ctrl+Alt+Space", "--taken", taken).split(/\r?\n/)).toEqual([
      "Alt+Shift+Space",
      "Ctrl+Win+Space",
      "Ctrl+Alt+J",
    ])
  })

  it("finds a shortcut another program holds, and that its alternatives are free", async () => {
    const key = "Ctrl+Alt+Shift+F19"
    const holder = spawn(exe, ["--hold", key], { windowsHide: true })
    try {
      const said = await new Promise<string>((resolve) =>
        holder.stdout.once("data", (d: Buffer) => resolve(d.toString().trim())),
      )
      expect(said).toBe("held")
      expect(run("--try", key)).toBe("clash")
      expect(run("--try", "Ctrl+Alt+Shift+F20")).toBe("free")
      expect(run("--try", "Shift+Q")).toMatch(/^bad: /)
    } finally {
      const gone = new Promise((resolve) => holder.once("exit", resolve))
      holder.stdin.end()
      await gone
    }
  })
})
