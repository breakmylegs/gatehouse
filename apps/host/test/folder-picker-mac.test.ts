import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { macFolderArgs, macPicked, macSaveArgs } from "../src/folder-picker-mac.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-pick-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** The script lines osascript runs, which come in pairs after -e, and what follows them. */
function split(args: string[]) {
  const lines: string[] = []
  let i = 0
  while (args[i] === "-e") {
    lines.push(args[i + 1]!)
    i += 2
  }
  return { lines, rest: args.slice(i) }
}

describe("the Mac folder and save windows", () => {
  it("keeps a name out of the script text, so it cannot become a command", () => {
    const evil = 'x" & (do shell script "rm -rf ~") & "'
    const { lines, rest } = split(macSaveArgs(evil))
    expect(lines.join("\n")).not.toContain("do shell script")
    expect(rest).toHaveLength(1)
    expect(rest[0]).not.toContain('"')
  })

  it("never lets a suggested name be read as an option, or hide the copy", () => {
    expect(split(macSaveArgs("-e beep")).rest[0]).toBe("_e beep")
    expect(split(macSaveArgs(".zshrc")).rest[0]).toBe("_zshrc")
    expect(split(macSaveArgs("a/b:c.txt")).rest[0]).toBe("a_b_c.txt")
    expect(split(macSaveArgs("")).rest[0]).toBe("copy")
  })

  it("starts in a folder only when it is an absolute folder that is there", () => {
    // On Windows a temporary folder is not a POSIX path, so it is not passed on either.
    const posix = dir.startsWith("/")
    expect(split(macFolderArgs(dir)).rest).toEqual(posix ? [dir] : [])
    expect(split(macFolderArgs("relative/folder")).rest).toEqual([])
    expect(split(macFolderArgs("/no/such/folder/here")).rest).toEqual([])
    expect(split(macFolderArgs()).rest).toEqual([])
  })

  it("reads a cancel as no answer and gives a folder without its trailing slash", () => {
    expect(macPicked("\n")).toBeUndefined()
    expect(macPicked("/Users/me/Projects/app/\n")).toBe("/Users/me/Projects/app")
    expect(macPicked("/\n")).toBe("/")
    expect(macPicked("/Users/me/Desktop/copy.md\n")).toBe("/Users/me/Desktop/copy.md")
  })
})
