// C-015: adaptive autonomy that only lowers. The record (30 days of the audit log) lowers a project's cap by itself;
// a session there starts no higher than the cap and cannot be raised past it; nothing but your click raises a cap.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { IndexEntry } from "../src/audit-index.js"
import { AutonomyStore, clamp, LIMITS, recommend, reviewAutonomy, signalsFor, WINDOW_MS } from "../src/autonomy.js"

const now = Date.parse("2026-11-20T12:00:00Z")
const entry = (o: Partial<IndexEntry>): IndexEntry => ({ seq: 1, ts: new Date(now - 86_400_000).toISOString(), session: "s", project: "shop", tool: "Bash", event: "decision", channel: "host", outcome: "allow", ruleId: "r", decidedBy: "rules", risk: 0, summary: "", ...o })
const floorDeny = (o: Partial<IndexEntry> = {}) => entry({ outcome: "deny", decidedBy: "floor", ...o })
const youDenied = (o: Partial<IndexEntry> = {}) => entry({ event: "human_decision", outcome: "deny", decidedBy: "human-desktop", ...o })
const many = (n: number, f: () => IndexEntry) => Array.from({ length: n }, f)

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-autonomy-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the record (C-015)", () => {
  it("counts the floor's denies and yours in the last 30 days for the project only", () => {
    const entries = [
      ...many(3, () => floorDeny()),
      floorDeny({ project: "other" }),
      floorDeny({ ts: new Date(now - WINDOW_MS - 1000).toISOString() }),
      entry({ decidedBy: "floor", outcome: "allow" }),
      youDenied(),
      entry({ event: "human_decision", outcome: "allow", decidedBy: "human-desktop" }),
    ]
    expect(signalsFor(entries, "shop", now)).toEqual({ floor: 3, denied: 1 })
  })

  it("asks for less the worse the record, and nothing for a clean one", () => {
    expect(recommend({ floor: 0, denied: 0 })).toEqual({ level: "extreme", reasons: [] })
    expect(recommend({ floor: LIMITS.floorToAcceptEdits, denied: 0 }).level).toBe("acceptEdits")
    expect(recommend({ floor: LIMITS.floorToManual, denied: 0 }).level).toBe("default")
    expect(recommend({ floor: 0, denied: LIMITS.deniedToAcceptEdits }).level).toBe("acceptEdits")
    expect(recommend({ floor: 1, denied: LIMITS.deniedToManual })).toMatchObject({ level: "default", reasons: [`you denied ${LIMITS.deniedToManual} calls in 30 days`] })
  })

  it("starts a session no higher than the cap", () => {
    expect(clamp("auto", false, "acceptEdits")).toEqual({ mode: "acceptEdits", extreme: false, lowered: true })
    expect(clamp("default", true, "acceptEdits")).toEqual({ mode: "default", extreme: false, lowered: true })
    expect(clamp("default", true, "extreme")).toEqual({ mode: "default", extreme: true, lowered: false })
    expect(clamp("acceptEdits", false, "plan")).toEqual({ mode: "plan", extreme: false, lowered: true })
    expect(clamp("plan", false, "default")).toEqual({ mode: "plan", extreme: false, lowered: false })
  })
})

describe("caps only go down by themselves (C-015)", () => {
  it("lowers by the record, recorded, and never raises however clean the record becomes", async () => {
    const store = new AutonomyStore(path.join(dir, "autonomy.json"))
    const recorded: Array<[string, Record<string, unknown>]> = []
    let entries: IndexEntry[] = many(LIMITS.floorToManual, () => floorDeny())
    const d = { store, entries: async () => entries, record: async (e: string, input: Record<string, unknown>) => (recorded.push([e, input]), true), now: () => now }
    expect(await reviewAutonomy(d)).toEqual([{ project: "shop", level: "default", reasons: [`the floor denied ${LIMITS.floorToManual} calls in 30 days`] }])
    expect(store.capFor("shop")).toBe("default")
    expect(recorded).toEqual([["autonomy_lowered", { project: "shop", level: "default" }]])
    // A spotless record from now on: the cap stays where it is, and nothing is recorded.
    entries = many(50, () => entry({}))
    expect(await reviewAutonomy(d)).toEqual([])
    expect(await store.lower("shop", "extreme", ["clean"])).toBe(false)
    expect(await store.lower("shop", "auto", ["clean"])).toBe(false)
    expect(store.capFor("shop")).toBe("default")
    expect(new AutonomyStore(path.join(dir, "autonomy.json")).capFor("shop")).toBe("default")
  })

  it("is raised only by you, and a cap you raised comes down again only for what happened since", async () => {
    const store = new AutonomyStore(path.join(dir, "autonomy.json"))
    await store.lower("shop", "default", ["the floor denied 10 calls in 30 days"], new Date(now - 2 * 86_400_000))
    await expect(store.raise("shop", "plan")).rejects.toThrow(/not higher/)
    await store.raise("shop", "auto", new Date(now - 86_400_000))
    expect(store.capFor("shop")).toBe("auto")
    const old = many(LIMITS.floorToManual, () => floorDeny({ ts: new Date(now - 3 * 86_400_000).toISOString() }))
    const d = { store, entries: async () => old, record: async () => true, now: () => now }
    expect(await reviewAutonomy(d)).toEqual([])
    const fresh = many(LIMITS.floorToAcceptEdits, () => floorDeny({ ts: new Date(now - 1000).toISOString() }))
    expect(await reviewAutonomy({ ...d, entries: async () => [...old, ...fresh] })).toMatchObject([{ project: "shop", level: "acceptEdits" }])
    await store.raise("shop", "extreme")
    expect(store.caps()).toEqual({})
  })
})
