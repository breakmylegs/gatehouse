// T-122 (t3code review): a session drafts a routine for you to save on the desktop. A draft is cleaned and capped, it
// is offered only to a coding session, and it never becomes a routine by itself.
import { describe, expect, it } from "vitest"
import { RoutineDrafts } from "../src/routine-drafts.js"
import { RoutineStore } from "../src/routines.js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

describe("routines drafted by a session (T-122)", () => {
  it("keeps a cleaned draft, with a sensible time and days, and makes no routine", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-"))
    try {
      const store = new RoutineStore(path.join(dir, "routines.json"))
      const drafts = new RoutineDrafts()
      const d = drafts.add({ sessionId: "s1", folder: "C:/dev/shop", name: "  Nightly\n tests ", prompt: "Run the tests", time: "25:00", days: ["sat", "sat", "xyz"] })
      expect(d).toMatchObject({ name: "Nightly tests", time: "08:00", days: ["sat"], folder: "C:/dev/shop" })
      expect(drafts.add({ sessionId: "s1", folder: "x", name: "A", prompt: "B" }).days).toEqual(["mon", "tue", "wed", "thu", "fri"])
      expect(() => drafts.add({ sessionId: "s1", folder: "x", name: " ", prompt: "B" })).toThrow(/name and a prompt/)
      expect(store.list()).toEqual([])
      expect(drafts.remove(d.id)).toBe(true)
      expect(drafts.remove(d.id)).toBe(false)
      for (let i = 0; i < 30; i++) drafts.add({ sessionId: "s1", folder: "x", name: `R${i}`, prompt: "p" })
      expect(drafts.list()).toHaveLength(20)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("is offered by the Companion only where the Host keeps drafts", async () => {
    const { createCompanionSdkServer } = await import("../src/companion-server.js")
    const base = { sessionId: "s", cwd: "C:/x", host: { notify: async () => true }, policy: () => undefined, redact: <T>(v: T) => v }
    const names = (deps: Parameters<typeof createCompanionSdkServer>[0]) =>
      Object.keys((createCompanionSdkServer(deps).instance as unknown as { _registeredTools: object })._registeredTools)
    expect(names(base)).not.toContain("draft_routine")
    expect(names({ ...base, routineDrafts: { draft: async () => ({ text: "" }) } })).toContain("draft_routine")
  })
})
