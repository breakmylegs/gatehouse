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
