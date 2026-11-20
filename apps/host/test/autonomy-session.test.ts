// C-015: a session in a project whose record capped it starts no higher than the cap, says what the cap is, and cannot
// be raised past it mid-session; a chat is not capped.
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { findProjectRoot } from "@gatehouse/policy"
import { AutonomyStore } from "../src/autonomy.js"
import { AutonomyCapError } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
let store: AutonomyStore
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  store = new AutonomyStore(path.join(s.dir, "autonomy.json"))
  s.deps.autonomy = store
  await store.lower(path.basename(findProjectRoot(s.repo)), "acceptEdits", ["the floor denied 3 calls in 30 days"])
}, 60000)
afterAll(async () => {
  await s.stop()
  fs.rmSync(path.join(s.dir, "autonomy.json"), { force: true })
})

describe("a capped project's sessions (C-015)", () => {
  it("start no higher than the cap and say so", async () => {
    const a = await s.manager.start({ cwd: s.repo, mode: "auto" })
    try {
      expect(a.info()).toMatchObject({ mode: "acceptEdits", autonomyCap: "acceptEdits" })
      expect(a.info().extreme ?? false).toBe(false)
    } finally {
      await a.close()
    }
    const b = await s.manager.start({ cwd: s.repo, mode: "default", extreme: true })
    try {
      expect(b.info()).toMatchObject({ mode: "default" })
      expect(b.info().extreme ?? false).toBe(false)
    } finally {
      await b.close()
    }
  })

  it("cannot be raised past it mid-session, saying why and where to raise it", async () => {
    const a = await s.manager.start({ cwd: s.repo, mode: "default" })
    try {
      await expect(a.setMode("auto")).rejects.toThrow(AutonomyCapError)
      await expect(a.setMode("auto")).rejects.toThrow(/capped at Accept edits because the floor denied 3 calls in 30 days\. Raise it in Settings/)
      await expect(a.setExtreme(true)).rejects.toThrow(AutonomyCapError)
      await a.setMode("acceptEdits")
      expect(a.info().mode).toBe("acceptEdits")
    } finally {
      await a.close()
    }
  })
})
