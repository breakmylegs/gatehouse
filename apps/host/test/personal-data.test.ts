// D-051: the personal data flow map, as a draft. Fields that look like personal data are found by name and followed to
// logs, storage and network calls on the same statement; comments, tests and dependencies are not read; and the draft
// for legal review says it is one, with its scope and the fields.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { legalDraft, personalDataMap, scanFile } from "../src/personal-data.js"

const CODE = [
  "export async function signUp(user: User) {",
  "  console.log('new user', user.email)",
  "  await db.users.insert({ phoneNumber: user.phone, firstName: user.first })",
  "  // console.log(user.dateOfBirth) is not run",
  "  await fetch('https://pay.example.com', { method: 'POST', body: JSON.stringify({ cardNumber }) })",
  "  const total = items.length",
  "}",
].join("\n")

describe("the personal data flow map (D-051)", () => {
  it("follows each field that looks like personal data to the log, the storage or the network call it goes to", () => {
    const r = scanFile("src/signup.ts", CODE)
    expect(r.flows.map((f) => [f.field, f.sink, f.line])).toEqual([
      ["email", "log", 2],
      ["phoneNumber", "storage", 3],
      ["firstName", "storage", 3],
      ["cardNumber", "network", 5],
    ])
    // The commented-out line is not read.
    expect(r.fields.map((f) => f.name)).not.toContain("dateOfBirth")
  })

  it("reads the project's own source, not its tests or dependencies, and gives a draft for legal review", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-pii-"))
    try {
      fs.mkdirSync(path.join(dir, "src"))
      fs.writeFileSync(path.join(dir, "src", "signup.ts"), CODE)
      fs.mkdirSync(path.join(dir, "node_modules", "lib"), { recursive: true })
      fs.writeFileSync(path.join(dir, "node_modules", "lib", "x.js"), "console.log(email)")
      fs.writeFileSync(path.join(dir, "src", "signup.test.ts"), "console.log(passportNumber)")
      const map = personalDataMap(dir, ["src/signup.ts", "node_modules/lib/x.js", "src/signup.test.ts"])
      expect(map.draft).toBe(true)
      expect(map.scope.files).toBe(1)
      expect(map.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["email", "phoneNumber", "cardNumber"]))
      expect(map.fields.map((f) => f.name)).not.toContain("passportNumber")
      const md = legalDraft(map)
      expect(md).toMatch(/^# Personal data flow map \(draft\)/)
      expect(md).toMatch(/## Scope[\s\S]*1 source files read/)
      expect(md).toMatch(/\| cardNumber \| network \| src\/signup\.ts \| 5 \|/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
