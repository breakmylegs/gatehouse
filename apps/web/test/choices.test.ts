import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import {
  applyChoices,
  CHOICES,
  levelPicks,
  readChoices,
  readLevel,
  type UserRulesShape,
} from "../src/lib/choices"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const fresh: UserRulesShape = { version: 1 }

describe("the plain choices over your rules", () => {
  it("reads a fresh install as Careful, with the extra Windows caution off", () => {
    const picks = readChoices(fresh)
    expect(picks).toEqual({
      edit: "code",
      git: "ask",
      build: "ask",
      run: "ask",
      install: "ask",
      web: "ask",
      push: "ask",
      caution: "off",
    })
    expect(readLevel(picks)).toBe("careful")
  })

  it("sets a level by switching packs, and reads it back", () => {
    const balanced = applyChoices(fresh, levelPicks("balanced"))
    expect(balanced.packs).toEqual([
      "build-tools",
      "dotnet-dev",
      "edit-workspace",
      "git-local",
      "git-read",
      "node-dev",
      "python-dev",
      "run-app",
      "web-read",
    ])
    expect(readLevel(readChoices(balanced))).toBe("balanced")
    const handsOff = applyChoices(balanced, levelPicks("handsoff"))
    expect(handsOff.packs).toContain("packages")
    expect(readLevel(readChoices(applyChoices(handsOff, levelPicks("careful"))))).toBe("careful")
  })

  it("keeps everything no choice manages", () => {
    const mine: UserRulesShape = {
      version: 1,
      packs: ["containers", "windows-safety"],
      disabled: ["safe-shell"],
      allow: [{ id: "my-hello", commands: ["echo hello"] }],
      deny: [{ id: "my-no-curl", commands: ["curl*"] }],
    }
    const next = applyChoices(mine, levelPicks("balanced"))
    expect(next.packs).toContain("containers")
    expect(next.packs).toContain("windows-safety")
    expect(next.disabled).toEqual(["safe-shell"])
    expect(next.allow).toEqual(mine.allow)
    expect(next.deny).toEqual(mine.deny)
    expect(readChoices(next).caution).toBe("on")
  })

  it("calls a choice changed in Advanced custom, and only an explicit pick replaces it", () => {
    const partly: UserRulesShape = { version: 1, packs: ["node-dev"] }
    expect(readChoices(partly).build).toBe("custom")
    expect(readLevel(readChoices(partly))).toBe("custom")
    expect(applyChoices(partly, { web: "allow" }).packs).toEqual(["node-dev", "web-read"])
    expect(applyChoices(partly, { build: "ask" }).packs).toBeUndefined()
  })

  it("blocks pushing with a deny of yours, and asking again removes only that", () => {
    const blocked = applyChoices({ version: 1, deny: [{ id: "my-no-curl" }] }, { push: "block" })
    expect(blocked.deny?.map((r) => r.id)).toEqual(["my-no-curl", "my-jcvc-no-push"])
    expect(readChoices(blocked).push).toBe("block")
    expect(applyChoices(blocked, { push: "ask" }).deny?.map((r) => r.id)).toEqual(["my-no-curl"])
  })

  it("only ever switches off a built-in allow, never a floor, deny or escalate rule", () => {
    const base = parse(fs.readFileSync(path.join(root, "policy/rules.yaml"), "utf8")) as Record<
      string,
      Array<{ id: string }>
    >
    const allows = new Set((base.allow ?? []).map((r) => r.id))
    const switchedOff = CHOICES.flatMap((c) => c.options.flatMap((o) => o.disabled ?? []))
    // A guard that finds nothing proves nothing.
    expect(switchedOff.length).toBeGreaterThan(0)
    for (const id of switchedOff) expect(allows.has(id), id).toBe(true)
  })

  it("names only packs that ship", () => {
    const shipped = new Set(
      fs.readdirSync(path.join(root, "policy/library")).map((f) => f.replace(/\.ya?ml$/, "")),
    )
    const named = CHOICES.flatMap((c) => c.options.flatMap((o) => o.packs ?? []))
    expect(named.length).toBeGreaterThan(5)
    for (const p of named) expect(shipped.has(p), p).toBe(true)
  })
})
