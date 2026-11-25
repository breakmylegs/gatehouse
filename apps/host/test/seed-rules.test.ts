// The shipped rules arrive with each update (25 Nov): an update carried the old policy folder over the new one, seed
// rules and all, so an install kept the rules it first had (one from 2 Nov had none of the rules since, read_session's
// among them, so Ask about code asked to read its own session). At start the Host puts the package's copy in place
// when policy/rules.yaml differs from it, keeping the file it replaces beside it; a rules file named elsewhere, and a
// folder with no copy (the source folder), are left alone.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { refreshSeedRules } from "../src/seed-rules.js"

let app: string
beforeEach(() => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"))
  fs.mkdirSync(path.join(app, "policy"))
  fs.mkdirSync(path.join(app, "policy-seed"))
  fs.writeFileSync(path.join(app, "policy-seed", "rules.yaml"), "version: 1\n# shipped with this version: session-read-tools\n")
})
afterEach(() => fs.rmSync(app, { recursive: true, force: true }))

const rules = () => path.join(app, "policy", "rules.yaml")
const now = () => new Date("2026-11-25T13:30:00Z")

describe("the shipped rules (25 Nov)", () => {
  it("replace an older copy an update carried over them, keeping that copy beside them", async () => {
    fs.writeFileSync(rules(), "version: 1\n# from 2 Nov\n")
    fs.writeFileSync(path.join(app, "policy", "rules.user.yaml"), "mine\n")
    const r = await refreshSeedRules({ appRoot: app, rulesPath: rules(), now })
    expect(r).toEqual({ refreshed: true, kept: `${rules()}.kept-202611251330` })
    expect(fs.readFileSync(rules(), "utf8")).toContain("session-read-tools")
    expect(fs.readFileSync(r.kept!, "utf8")).toBe("version: 1\n# from 2 Nov\n")
    // Your own rules are never touched.
    expect(fs.readFileSync(path.join(app, "policy", "rules.user.yaml"), "utf8")).toBe("mine\n")
  })

  it("leave the file alone when it is already the shipped one, and make it when it is missing", async () => {
    fs.copyFileSync(path.join(app, "policy-seed", "rules.yaml"), rules())
    expect(await refreshSeedRules({ appRoot: app, rulesPath: rules(), now })).toEqual({ refreshed: false })
    expect(fs.readdirSync(path.join(app, "policy"))).toEqual(["rules.yaml"])
    fs.rmSync(rules())
    expect(await refreshSeedRules({ appRoot: app, rulesPath: rules(), now })).toEqual({ refreshed: true })
    expect(fs.readFileSync(rules(), "utf8")).toContain("session-read-tools")
  })

  it("never touch a rules file named elsewhere, nor anything without the package's copy", async () => {
    const elsewhere = path.join(app, "my-rules.yaml")
    fs.writeFileSync(elsewhere, "version: 1\n# mine\n")
    fs.writeFileSync(rules(), "version: 1\n# from 2 Nov\n")
    expect(await refreshSeedRules({ appRoot: app, rulesPath: elsewhere, now })).toEqual({ refreshed: false })
    expect(fs.readFileSync(elsewhere, "utf8")).toBe("version: 1\n# mine\n")
    fs.rmSync(path.join(app, "policy-seed"), { recursive: true })
    expect(await refreshSeedRules({ appRoot: app, rulesPath: rules(), now })).toEqual({ refreshed: false })
    expect(fs.readFileSync(rules(), "utf8")).toBe("version: 1\n# from 2 Nov\n")
  })
})
