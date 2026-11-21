// D-019: a capped project with a clean record since its cap was set earns a proposal to raise it by one step. The
// proposal is kept and recorded; it never applies by itself, however often the record is read.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { entryOf, type IndexEntry } from "../src/audit-index.js"
import { AutonomyStore, EARN, propose, reviewAutonomy, trackRecord, type TrackRecord } from "../src/autonomy.js"

const now = Date.parse("2026-11-20T12:00:00Z")
const capAt = new Date(now - 10 * 86_400_000).toISOString()
const entry = (o: Partial<IndexEntry>): IndexEntry => ({ seq: 1, ts: new Date(now - 86_400_000).toISOString(), session: "s", project: "shop", tool: "Bash", event: "decision", channel: "host", outcome: "allow", ruleId: "r", decidedBy: "rules", risk: 0, summary: "", ...o })
const approved = () => entry({ event: "human_decision", decidedBy: "human-desktop" })
const verified = () => entry({ event: "claim_verified", tool: "claims", good: true })
const many = (n: number, f: () => IndexEntry) => Array.from({ length: n }, f)
const clean = () => [...many(EARN.approvals, approved), ...many(EARN.verified, verified), entry({ event: "sealed_check_run", good: true })]
const zero: TrackRecord = { approvals: 0, undone: 0, sealedPassed: 0, sealedFailed: 0, verified: 0, contradicted: 0, floor: 0 }

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-earned-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the track record", () => {
  it("marks a sealed check that passed and a Verified claim in the index, and nothing else", () => {
    const rec = (event: string, input: unknown) =>
      entryOf({ seq: 1, ts: "t", session: "s", event, channel: "host", tool: "x", cwd: "", inputJson: JSON.stringify(input), verdict: { outcome: "allow", ruleId: "r", reason: "", risk: 0, decidedBy: "rules", policyHash: "" }, latencyMs: 0, prevHash: "", hash: "" } as never)
    expect(rec("sealed_check_run", { ok: true }).good).toBe(true)
    expect(rec("sealed_check_run", { ok: false }).good).toBeUndefined()
    expect(rec("claim_verified", { outcome: "verified" }).good).toBe(true)
    expect(rec("claim_verified", { outcome: "unverified" }).good).toBeUndefined()
    expect(rec("decision", { ok: true, outcome: "verified" }).good).toBeUndefined()
  })

  it("counts the project's approvals, undos, sealed checks, claims and floor denies since the cap", () => {
    const old = new Date(now - 20 * 86_400_000).toISOString()
    const entries = [
      ...clean(),
      entry({ event: "files_undone" }),
      entry({ event: "sealed_check_run" }),
      entry({ event: "claim_verified", outcome: "deny" }),
      entry({ event: "claim_verified" }),
      entry({ decidedBy: "floor", outcome: "deny" }),
      approved(),
      { ...approved(), project: "other" },
      { ...entry({ decidedBy: "floor", outcome: "deny" }), ts: old },
    ]
    expect(trackRecord(entries, "shop", capAt)).toEqual({ approvals: EARN.approvals + 1, undone: 1, sealedPassed: 1, sealedFailed: 1, verified: EARN.verified, contradicted: 1, floor: 1 })
  })

  it("earns one step up only when clean and enough, and nothing past no cap", () => {
    const good = { ...zero, approvals: EARN.approvals, verified: EARN.verified }
    expect(propose(good, "default")).toMatchObject({ from: "default", to: "acceptEdits" })
    expect(propose(good, "plan")).toMatchObject({ to: "default" })
    expect(propose(good, "auto")).toMatchObject({ to: "extreme" })
    expect(propose(good, "extreme")).toBeUndefined()
    for (const bad of [{ undone: 1 }, { floor: 1 }, { contradicted: 1 }, { sealedFailed: 1 }, { approvals: EARN.approvals - 1 }, { verified: EARN.verified - 1 }])
      expect(propose({ ...good, ...bad }, "default")).toBeUndefined()
  })
})

describe("a proposal never applies by itself", () => {
  it("is kept and recorded once, and the cap stays however often the record is read", async () => {
    const store = new AutonomyStore(path.join(dir, "autonomy.json"))
    await store.lower("shop", "default", ["the floor denied 10 calls"], new Date(capAt))
    const recorded: Array<[string, Record<string, unknown>]> = []
    const d = { store, entries: async () => clean(), record: async (e: string, input: Record<string, unknown>) => (recorded.push([e, input]), true), now: () => now }
    for (let i = 0; i < 5; i++) await reviewAutonomy(d)
    expect(store.capFor("shop")).toBe("default")
    expect(store.proposals()).toMatchObject({ shop: { from: "default", to: "acceptEdits" } })
    expect(recorded).toEqual([["autonomy_raise_proposed", { project: "shop", from: "default", to: "acceptEdits" }]])
    expect(new AutonomyStore(path.join(dir, "autonomy.json")).proposals().shop?.to).toBe("acceptEdits")
  })

  it("goes when the record turns bad, when the cap moves, and after a no until it is earned again", async () => {
    const store = new AutonomyStore(path.join(dir, "autonomy.json"))
    await store.lower("shop", "default", ["x"], new Date(capAt))
    let entries = clean()
    const d = { store, entries: async () => entries, record: async () => true, now: () => now }
    await reviewAutonomy(d)
    entries = [...clean(), entry({ event: "change_undone" })]
    await reviewAutonomy(d)
    expect(store.proposals()).toEqual({})
    entries = clean()
    await reviewAutonomy(d)
    await store.decline("shop", new Date(now - 1000))
    await reviewAutonomy(d)
    expect(store.proposals()).toEqual({})
    entries = [...clean(), ...clean().map((e) => ({ ...e, ts: new Date(now - 500).toISOString() }))]
    await reviewAutonomy(d)
    expect(store.proposals().shop?.to).toBe("acceptEdits")
    await store.raise("shop", "auto")
    expect(store.proposals()).toEqual({})
  })
})
