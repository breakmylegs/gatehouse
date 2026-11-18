// @vitest-environment jsdom
// E-094, the escalation ladder in Settings: at once by default and saved as no setting, a wait saved in minutes for
// each kind of channel, read back as it was, and fields an older or newer copy wrote kept.
import { describe, expect, it } from "vitest"
import { GatehouseConfig } from "@gatehouse/shared/node"
import { bodyOf, valuesOf } from "../src/surfaces/Settings"

type Data = Parameters<typeof valuesOf>[0]
const data = (saved: Record<string, unknown> = {}): Data =>
  ({
    path: "settings.json",
    saved,
    // The Host's own defaults, as /api/settings sends them.
    running: GatehouseConfig.parse({}),
    workspaceRootsInEffect: [],
    quietHoursInPolicy: null,
  }) as unknown as Data

describe("who is told, and when (E-094)", () => {
  it("tells every channel at once unless you choose a wait, and saves nothing for it", () => {
    const d = data()
    const v = valuesOf(d)
    expect([v.ladPhone, v.ladPush]).toEqual(["0", "0"])
    expect(bodyOf(d, v)).not.toHaveProperty("escalationLadder")
  })

  it("saves the waits in minutes, reads them back, and keeps what it does not know", () => {
    const d = data({ escalationLadder: { later: true } })
    const body = bodyOf(d, { ...valuesOf(d), ladPhone: "2", ladPush: "10" })
    expect(body.escalationLadder).toEqual({ later: true, phoneAfterMinutes: 2, pushAfterMinutes: 10 })
    const back = valuesOf(data({ escalationLadder: body.escalationLadder }))
    expect([back.ladPhone, back.ladPush]).toEqual(["2", "10"])
    // Back to at once: the setting goes.
    expect(bodyOf(d, { ...valuesOf(d), ladPhone: "0", ladPush: "0" })).not.toHaveProperty("escalationLadder")
  })

  it("saves waiting only while you use the Mac when chosen, and reads it back (Mac fork, 18 Nov)", () => {
    const d = data()
    expect(valuesOf(d).ladHere).toBe(false)
    const body = bodyOf(d, { ...valuesOf(d), ladPhone: "2", ladHere: true })
    expect(GatehouseConfig.parse({ escalationLadder: body.escalationLadder }).escalationLadder?.onlyWhenHere).toBe(true)
    expect(valuesOf(data({ escalationLadder: body.escalationLadder })).ladHere).toBe(true)
    const off = bodyOf(d, { ...valuesOf(d), ladPhone: "2", ladHere: false })
    expect(JSON.parse(JSON.stringify(off.escalationLadder))).not.toHaveProperty("onlyWhenHere")
  })
})

describe("the timeline's summaries (O42)", () => {
  it("are on unless turned off, and only off is saved", () => {
    const d = data()
    expect(valuesOf(d).tlOn).toBe(true)
    expect(bodyOf(d, valuesOf(d))).not.toHaveProperty("timelineSummaries")
    expect(bodyOf(d, { ...valuesOf(d), tlOn: false }).timelineSummaries).toBe(false)
    expect(valuesOf(data({ timelineSummaries: false })).tlOn).toBe(false)
  })
})

describe("writing rules (E-086)", () => {
  it("are the house style unless changed, saving only what differs and keeping what a newer copy wrote", () => {
    const d = data()
    expect([valuesOf(d).writeUk, valuesOf(d).writeDashes]).toEqual([true, true])
    expect(bodyOf(d, valuesOf(d))).not.toHaveProperty("writingRules")
    const kept = data({ writingRules: { later: 1 } })
    const body = bodyOf(kept, { ...valuesOf(kept), writeDashes: false, writeTerms: "Codehouse = CodeHouse, Code house\nnot a term", writeBanned: "synergy\n" })
    expect(body.writingRules).toEqual({ later: 1, noDashes: false, terms: [{ use: "Codehouse", not: ["CodeHouse", "Code house"] }], banned: ["synergy"] })
    const back = valuesOf(data({ writingRules: body.writingRules }))
    expect([back.writeDashes, back.writeTerms, back.writeBanned]).toEqual([false, "Codehouse = CodeHouse, Code house", "synergy"])
  })
})

describe("team redaction list keys (E-080)", () => {
  it("saves each PEM block as a key, and nothing when the box is empty", () => {
    const d = data()
    expect(bodyOf(d, valuesOf(d))).not.toHaveProperty("redactionListKeys")
    const pem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----"
    const body = bodyOf(d, { ...valuesOf(d), teamKeys: `${pem}\n\n${pem.replace("MCow", "MCox")}` })
    expect(body.redactionListKeys).toHaveLength(2)
    expect(valuesOf(data({ redactionListKeys: body.redactionListKeys })).teamKeys).toContain("MCox")
  })
})

describe("settling finished sessions (T-024)", () => {
  it("is three days unless you choose, and only another choice is saved", () => {
    const d = data()
    expect(valuesOf(d).settleDays).toBe("3")
    expect(bodyOf(d, valuesOf(d))).not.toHaveProperty("settleAfterDays")
    expect(bodyOf(d, { ...valuesOf(d), settleDays: "0" }).settleAfterDays).toBe(0)
    expect(valuesOf(data({ settleAfterDays: 7 })).settleDays).toBe("7")
  })
})
