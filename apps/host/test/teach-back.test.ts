// E-071: an explanation that misses a changed module lists that module, with its files and lines.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { changedSince, moduleOf, teachBack } from "../src/teach-back.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const CHANGE = [
  { file: "src/billing/invoice.ts", added: 40, removed: 10 },
  { file: "src/billing/tax.ts", added: 12, removed: 2 },
  { file: "db/migrations/007_invoice_status.sql", added: 8, removed: 0 },
  { file: "src/notifications/email-sender.ts", added: 30, removed: 0 },
  { file: "README.md", added: 3, removed: 1 },
]

describe("the teach-back check", () => {
  it("lists a changed module the explanation does not mention, with its files and lines", () => {
    const r = teachBack("Invoices now carry a status, and the tax is worked out once per invoice. The README says how.", CHANGE)
    expect(r.covered.sort()).toEqual(["README.md", "src/billing"])
    expect(r.gaps).toEqual([
      { module: "src/notifications", files: ["src/notifications/email-sender.ts"], lines: 30 },
      { module: "db/migrations", files: ["db/migrations/007_invoice_status.sql"], lines: 8 },
    ])
    expect(r.modules).toBe(4)
    expect(r.lines).toBe(106)
  })

  it("counts a module named by its folder or by one of its files, in any spelling", () => {
    const r = teachBack("Billing, the email sender for notifications, and a new DB migration. Also the readme.", CHANGE)
    expect(r.gaps).toEqual([])
    // A word that is only part of another word does not count as naming a short module.
    expect(teachBack("We changed the tax rules.", [{ file: "src/ax/x.ts", added: 1, removed: 0 }]).gaps).toHaveLength(1)
    // Folder names every project has (src, lib, tests) name no module.
    expect(teachBack("Lots of changes across src and the tests.", [{ file: "src/notifications/x.ts", added: 1, removed: 0 }]).gaps).toHaveLength(1)
    expect(moduleOf("a/b/c/d.ts")).toBe("a/b")
    expect(moduleOf("top.ts")).toBe("top.ts")
  })

  it("reads the change from git, committed since the default branch and not yet committed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-teach-"))
    dirs.push(root)
    const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: root, encoding: "utf8" })
    g("init", "-q", "-b", "main")
    fs.mkdirSync(path.join(root, "src", "billing"), { recursive: true })
    fs.writeFileSync(path.join(root, "src", "billing", "invoice.ts"), "a\n")
    g("add", "-A")
    g("commit", "-qm", "start")
    g("switch", "-qc", "work")
    fs.writeFileSync(path.join(root, "src", "billing", "invoice.ts"), "a\nb\nc\n")
    g("commit", "-qam", "more")
    fs.mkdirSync(path.join(root, "src", "mail"))
    fs.writeFileSync(path.join(root, "src", "mail", "send.ts"), "x\n")
    const files = await changedSince(root)
    expect(files).toEqual(expect.arrayContaining([{ file: "src/billing/invoice.ts", added: 2, removed: 0 }, expect.objectContaining({ file: "src/mail/send.ts" })]))
    expect(teachBack("The invoice change.", files).gaps.map((x) => x.module)).toEqual(["src/mail"])
  })
})
