import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import { stringify as stringifyYaml } from "yaml"
import { PolicyEngine } from "../src/engine.js"
import { loadLibrary } from "../src/library.js"
import { loadPolicy, PolicyLoadError } from "../src/loader.js"
import { fwd, makeFixture, SEED_RULES } from "./helpers.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const LIBRARY = path.resolve(here, "../../../policy/library")
const fx = makeFixture()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gh-library-"))
afterAll(() => {
  fx.dispose()
  fs.rmSync(tmp, { recursive: true, force: true })
})

let n = 0
function withUserRules(user: unknown) {
  const file = path.join(tmp, `rules.user.${n++}.yaml`)
  fs.writeFileSync(file, stringifyYaml(user))
  return loadPolicy({
    rulesPath: SEED_RULES,
    workspaceRootsOverride: [fwd(fx.ws)],
    libraryDir: LIBRARY,
    userRulesPath: file,
  })
}

const packs = loadLibrary(LIBRARY, [])

describe("the shipped rule library", () => {
  it("loads cleanly, has real packs, and every pack has cases", () => {
    const errors: string[] = []
    const loaded = loadLibrary(LIBRARY, errors)
    expect(errors).toEqual([])
    // A guard that finds nothing proves nothing: there must be a real corpus to check.
    expect(loaded.length).toBeGreaterThanOrEqual(10)
    for (const p of loaded) expect(p.cases?.length ?? 0, p.id).toBeGreaterThanOrEqual(3)
  })

  it("changes nothing until a pack is switched on", () => {
    const plain = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)] })
    const withLibrary = loadPolicy({
      rulesPath: SEED_RULES,
      workspaceRootsOverride: [fwd(fx.ws)],
      libraryDir: LIBRARY,
      userRulesPath: path.join(tmp, "missing.yaml"),
    })
    expect(withLibrary.hash).toBe(plain.hash)
  })

  for (const pack of packs) {
    it(`pack ${pack.id}: every case decides as written, with only that pack on`, async () => {
      const policy = withUserRules({ version: 1, packs: [pack.id] })
      const engine = new PolicyEngine({ getPolicy: () => policy })
      for (const c of pack.cases ?? []) {
        const v = await engine.evaluate({ toolName: c.tool, input: c.input }, { cwd: fx.ws })
        const label = `${pack.id}: ${JSON.stringify(c.input)}`
        expect(v.outcome, label).toBe(c.expect)
        if (c.rule) expect(v.ruleId, label).toBe(c.rule)
      }
    })
  }
})

describe("your own rules", () => {
  it("switches on a pack, switches off a built-in allow, and adds a rule of yours", async () => {
    const policy = withUserRules({
      version: 1,
      packs: ["node-dev"],
      disabled: ["safe-shell"],
      allow: [{ id: "my-hello", everySegmentMustMatch: true, commands: ["echo hello"] }],
    })
    const engine = new PolicyEngine({ getPolicy: () => policy })
    const run = (command: string) => engine.evaluate({ toolName: "Bash", input: { command } }, { cwd: fx.ws })
    expect((await run("npm run build")).outcome).toBe("allow")
    expect((await run("git status")).outcome).toBe("escalate")
    expect(await run("echo hello")).toMatchObject({ outcome: "allow", ruleId: "my-hello" })
    expect(policy.sources?.["node-dev-scripts"]).toBe("pack:node-dev")
    expect(policy.sources?.["my-hello"]).toBe("yours")
    expect(policy.sources?.["safe-shell"]).toBe("base")
  })

  it("can never switch off the floor or a deny rule", () => {
    for (const id of ["secrets-files", "obfuscated-shell", "destructive-shell", "outside-workspace-write"]) {
      expect(() => withUserRules({ version: 1, disabled: [id] }), id).toThrow(/cannot be switched off/)
    }
  })

  it("cannot lift the floor with an allow of your own", async () => {
    const policy = withUserRules({
      version: 1,
      allow: [{ id: "my-read-everything", tools: ["Read"], pathInside: "workspaceRoots" }],
    })
    const engine = new PolicyEngine({ getPolicy: () => policy })
    const v = await engine.evaluate(
      { toolName: "Read", input: { file_path: path.join(fx.ws, ".env") } },
      { cwd: fx.ws },
    )
    expect(v).toMatchObject({ outcome: "deny", ruleId: "secrets-files" })
  })

  it("refuses floor rules, workspace changes, unknown packs, bad ids and unsafe allows", () => {
    const bad: unknown[] = [
      { version: 1, floor: [] },
      { version: 1, workspaceRoots: ["C:/"] },
      { version: 1, packs: ["no-such-pack"] },
      { version: 1, disabled: ["no-such-rule"] },
      { version: 1, allow: [{ id: "hello", commands: ["echo hi"] }] },
      { version: 1, allow: [{ id: "my-outside", tools: ["Write"], pathOutside: "workspaceRoots" }] },
      { version: 1, allow: [{ id: "my-everything" }] },
      { version: 1, allow: [{ id: "safe-shell", commands: ["echo"] }] },
    ]
    for (const user of bad) expect(() => withUserRules(user), JSON.stringify(user)).toThrow(PolicyLoadError)
  })

  it("adds deny rules of yours, which win over every allow", async () => {
    const policy = withUserRules({
      version: 1,
      deny: [{ id: "my-no-status", commands: ["git status*"] }],
    })
    const engine = new PolicyEngine({ getPolicy: () => policy })
    const v = await engine.evaluate({ toolName: "Bash", input: { command: "git status" } }, { cwd: fx.ws })
    expect(v).toMatchObject({ outcome: "deny", ruleId: "my-no-status" })
  })
})
