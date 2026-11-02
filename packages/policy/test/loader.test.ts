import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { loadPolicy, PolicyLoadError, PolicyStore } from "../src/loader.js"
import { checkOverlay, checkRememberFile, checkRulesFile } from "../src/schema.js"
import { SEED_RULES } from "./helpers.js"

let dir: string
let n = 0

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-loader-"))
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

type Doc = Record<string, unknown> & {
  workspaceRoots: string[]
  floor: Record<string, unknown>[]
  deny: Record<string, unknown>[]
  escalate: Record<string, unknown>[]
  allow: Record<string, unknown>[]
}

function seed(): Doc {
  return parseYaml(fs.readFileSync(SEED_RULES, "utf8")) as Doc
}

function write(doc: unknown, name = `rules-${n++}.yaml`): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, typeof doc === "string" ? doc : stringifyYaml(doc))
  return file
}

function errorsOf(doc: unknown, extra: Partial<Parameters<typeof loadPolicy>[0]> = {}): string[] {
  try {
    loadPolicy({ rulesPath: write(doc), ...extra })
  } catch (e) {
    if (e instanceof PolicyLoadError) return e.errors
    throw e
  }
  return []
}

describe("loadPolicy", () => {
  it("loads the seed rules and expands <you> in workspace roots", () => {
    const p = loadPolicy({ rulesPath: SEED_RULES, user: "pat" })
    expect(p.rules.workspaceRoots).toContain("C:/Users/pat/source")
    expect(p.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(p.workspaceRootKeys[0]).toBe("c:/dev")
  })

  it("lets the caller replace the workspace roots", () => {
    const p = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: ["C:/elsewhere"] })
    expect(p.rules.workspaceRoots).toEqual(["C:/elsewhere"])
  })

  it("gives the same hash for the same content and a new one when a rule changes", () => {
    const a = loadPolicy({ rulesPath: SEED_RULES, user: "pat" })
    const b = loadPolicy({ rulesPath: write(seed()), user: "pat" })
    expect(b.hash).toBe(a.hash)
    const changed = seed()
    changed.deny.push({ id: "extra-deny", commands: ["shutdown*"] })
    expect(loadPolicy({ rulesPath: write(changed), user: "pat" }).hash).not.toBe(a.hash)
  })

  it("reports a missing file, bad YAML and a schema failure", () => {
    expect(() => loadPolicy({ rulesPath: path.join(dir, "missing.yaml") })).toThrow(PolicyLoadError)
    expect(errorsOf("version: [unclosed")).not.toEqual([])
    expect(errorsOf({ version: 1 }).join()).toContain("workspaceRoots")
  })

  it("only accepts escalate for unknownTool and parseError defaults", () => {
    const d = seed()
    d.defaults = { unknownTool: "allow" }
    expect(errorsOf(d).join()).toContain("equal to constant")
  })

  it("rejects a rule with no selector", () => {
    const d = seed()
    d.deny.push({ id: "empty-rule", message: "x" })
    expect(errorsOf(d).join()).toContain("deny/empty-rule: rule has no selector")
  })

  it("rejects allow rules that widen in odd ways", () => {
    const d = seed()
    d.allow.push({ id: "bad-a", tools: ["Read"], pathOutside: "workspaceRoots" })
    d.allow.push({ id: "bad-b", tools: ["Read"], pathUnc: true })
    d.allow.push({ id: "bad-c", tools: ["Read"], powershell: { encodedCommand: true } })
    d.allow.push({ id: "bad-d", pathGlobs: ["**"] })
    const joined = errorsOf(d).join("\n")
    expect(joined).toContain("allow/bad-a: allow rules cannot use pathOutside or pathUnc")
    expect(joined).toContain("allow/bad-b")
    expect(joined).toContain("allow/bad-c: allow rules cannot use powershell or bash flags")
    expect(joined).toContain("allow/bad-d: allow rules need tools or commands")
  })

  it("rejects allow rules that say everySegmentMustMatch is false", () => {
    const d = seed()
    d.allow.push({ id: "loose", commands: ["x*"], everySegmentMustMatch: false })
    expect(errorsOf(d).join()).toContain("equal to constant")
  })

  it("rejects duplicate rule ids across sections", () => {
    const d = seed()
    d.escalate.push({ id: "safe-shell", tools: ["Bash"] })
    expect(errorsOf(d).join()).toContain("duplicate rule id")
  })

  it("rejects a bad rule id", () => {
    const d = seed()
    d.deny.push({ id: "Bad Id", tools: ["Bash"] })
    expect(errorsOf(d).join()).toContain("pattern")
  })
})

describe("overlays and remember files on disk", () => {
  it("loads overlays by project name and includes them in the hash", () => {
    const overlayDir = fs.mkdtempSync(path.join(dir, "ov-"))
    fs.writeFileSync(
      path.join(overlayDir, "Client-A.yaml"),
      stringifyYaml({ version: 1, deny: [{ id: "no-curl", commands: ["curl*"] }] }),
    )
    fs.writeFileSync(path.join(overlayDir, "notes.txt"), "ignored")
    const without = loadPolicy({ rulesPath: SEED_RULES })
    const withOverlay = loadPolicy({ rulesPath: SEED_RULES, overlayDir })
    expect(Object.keys(withOverlay.overlays)).toEqual(["client-a"])
    expect(withOverlay.hash).not.toBe(without.hash)
  })

  it("rejects an unreadable overlay and a missing overlay directory is fine", () => {
    const overlayDir = fs.mkdtempSync(path.join(dir, "ov-"))
    fs.writeFileSync(path.join(overlayDir, "bad.yaml"), "version: [")
    expect(() => loadPolicy({ rulesPath: SEED_RULES, overlayDir })).toThrow(PolicyLoadError)
    expect(loadPolicy({ rulesPath: SEED_RULES, overlayDir: path.join(dir, "nope") }).overlays).toEqual({})
  })

  it("rejects an unreadable remember file", () => {
    const local = path.join(dir, "bad-local.yaml")
    fs.writeFileSync(local, "version: [")
    expect(() => loadPolicy({ rulesPath: SEED_RULES, localPath: local })).toThrow(PolicyLoadError)
  })

  it("turns remember entries into exact rules with remember- ids", () => {
    const local = path.join(dir, "local.yaml")
    fs.writeFileSync(
      local,
      stringifyYaml({
        version: 1,
        remember: [
          { id: "one", tool: "Bash", command: "npm install lodash" },
          { id: "two", tool: "Edit", path: "C:/dev/x/y.ts" },
        ],
      }),
    )
    const p = loadPolicy({ rulesPath: SEED_RULES, localPath: local })
    expect(p.remember.map((r) => r.id)).toEqual(["remember-one", "remember-two"])
    expect(p.remember[0]).toMatchObject({ remember: true, commands: ["npm install lodash"] })
    expect(p.remember[1]?.paths?.[0]).toBe("c:/dev/x/y.ts")
  })
})

describe("schema checks", () => {
  it("validates quiet hours", () => {
    const d = seed()
    expect(checkRulesFile(d).ok).toBe(true)
    d.quietHours = { start: "25:00", end: "07:00", tz: "UTC" }
    expect(checkRulesFile(d).ok).toBe(false)
  })
  it("checkOverlay and checkRememberFile reject non-objects", () => {
    expect(checkOverlay(5).ok).toBe(false)
    expect(checkOverlay(null).ok).toBe(false)
    expect(checkRememberFile("x").ok).toBe(false)
    expect(checkRememberFile({ version: 1, remember: [] }).ok).toBe(true)
  })
})

describe("PolicyStore", () => {
  it("keeps a good policy when a later edit is broken, then recovers", () => {
    const file = write(seed(), "store.yaml")
    const store = new PolicyStore({ rulesPath: file })
    expect(store.current).toBeUndefined()
    expect(store.load()).toBe(true)
    const good = store.current
    expect(good).toBeDefined()
    expect(store.load()).toBe(false)

    fs.writeFileSync(file, "version: 1\nworkspaceRoots: []\n")
    expect(store.load()).toBe(false)
    expect(store.current?.hash).toBe(good?.hash)
    expect(store.status().errors.length).toBeGreaterThan(0)
    expect(store.status().hash).toBe(good?.hash)

    const fixed = seed()
    fixed.deny.push({ id: "added-deny", commands: ["shutdown*"] })
    fs.writeFileSync(file, stringifyYaml(fixed))
    expect(store.load()).toBe(true)
    expect(store.current?.hash).not.toBe(good?.hash)
    expect(store.status().errors).toEqual([])
    expect(store.status().overlays).toEqual([])
    expect(store.status().loadedAt).toBeDefined()
  })

  it("reports a first load that fails, with no policy installed", () => {
    const store = new PolicyStore({ rulesPath: path.join(dir, "absent.yaml") })
    expect(store.load()).toBe(false)
    expect(store.current).toBeUndefined()
    expect(store.status().errors.length).toBe(1)
  })

  it("hot reloads when the file changes and tells the listener", async () => {
    const file = write(seed(), "hot.yaml")
    const store = new PolicyStore({ rulesPath: file })
    store.load()
    const before = store.current?.hash
    const changed = new Promise<string | undefined>((resolve) => {
      store.onChange = (s) => resolve(s.hash)
    })
    store.watch(20)
    const next = seed()
    next.deny.push({ id: "hot-deny", commands: ["reboot*"] })
    fs.writeFileSync(file, stringifyYaml(next))
    const hash = await changed
    store.close()
    expect(hash).toBeDefined()
    expect(hash).not.toBe(before)
    expect(store.current?.hash).toBe(hash)
  })

  it("is not held back by constant unrelated activity in the same folder", async () => {
    const watched = fs.mkdtempSync(path.join(dir, "busy-"))
    const file = path.join(watched, "rules.yaml")
    fs.writeFileSync(file, stringifyYaml(seed()))
    const store = new PolicyStore({ rulesPath: file })
    store.load()
    const before = store.current?.hash
    const changed = new Promise<string | undefined>((resolve) => {
      store.onChange = (s) => resolve(s.hash)
    })
    store.watch(150)
    // Writes to other files every 30 ms, well inside the 150 ms debounce, for the whole time.
    const noise = setInterval(() => fs.writeFileSync(path.join(watched, "noise.txt"), String(Date.now())), 30)
    try {
      const next = seed()
      next.deny.push({ id: "busy-deny", commands: ["halt*"] })
      fs.writeFileSync(file, stringifyYaml(next))
      const hash = await Promise.race([
        changed,
        new Promise<string>((resolve) => setTimeout(() => resolve("never reloaded"), 4000)),
      ])
      expect(hash).not.toBe("never reloaded")
      expect(hash).not.toBe(before)
    } finally {
      clearInterval(noise)
      store.close()
    }
  })

  it("watches overlay and local folders too, and close is safe to repeat", () => {
    const file = write(seed(), "watch.yaml")
    const overlayDir = fs.mkdtempSync(path.join(dir, "wov-"))
    const store = new PolicyStore({ rulesPath: file, overlayDir, localPath: path.join(dir, "watch-local.yaml") })
    store.load()
    store.watch()
    store.close()
    store.close()
  })
})
