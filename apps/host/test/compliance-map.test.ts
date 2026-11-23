// E-065: each DORA and NIS2 control area either links to evidence or is listed as a gap.
import { describe, expect, it } from "vitest"
import type { AuditRecord } from "@gatehouse/shared/audit"
import { complianceIndex, CONTROLS, gatherSources, indexMarkdown } from "../src/compliance-map.js"

const rec = (event: string, project = "shop") => ({ event, project, session: "s", channel: "desktop", tool: "Bash" }) as unknown as AuditRecord

describe("DORA and NIS2 evidence index", () => {
  it("links each control area to evidence, or lists it as a gap", () => {
    const sources = gatherSources({
      project: "shop",
      records: [rec("decision"), rec("floor_deny"), rec("sealed_check_run"), rec("backout_checked"), rec("kill_switch_engaged"), rec("release_readiness", "other")],
      packs: { commits: 10, withPack: 4 },
      aiModels: 2,
      residencySessions: 0,
      policyHash: "abcdef0123456789",
    })
    const rows = complianceIndex(sources)
    expect(rows).toHaveLength(CONTROLS.length)
    for (const r of rows) {
      if (r.gap) expect(r.evidence).toEqual([])
      else expect(r.evidence.length).toBeGreaterThan(0)
      expect(r.gap || r.evidence.every((e) => sources[e.source].present)).toBe(true)
    }
    const row = (ref: string) => rows.find((r) => r.control.ref === ref)!
    expect(row("Art. 24-25")).toMatchObject({ gap: false })
    expect(row("Art. 24-25").evidence.map((e) => e.source)).toEqual(["sealed-checks", "evidence-packs"])
    // Another project's change record is not this project's.
    expect(sources["change-records"].present).toBe(false)
    // An area Codehouse records nothing for is always a gap, saying evidence from outside is needed.
    expect(row("Art. 21(2)(g)")).toMatchObject({ gap: true, wouldServe: expect.stringMatching(/outside Codehouse/) })
    expect(row("Art. 21(2)(j)")).toMatchObject({ gap: true })
  })

  it("turns a control area with nothing found into a gap that names what would serve", () => {
    const rows = complianceIndex(gatherSources({ project: "new", records: [], packs: { commits: 0, withPack: 0 }, aiModels: 0, residencySessions: 0 }))
    const incident = rows.find((r) => r.control.ref === "Art. 23")!
    expect(incident).toMatchObject({ gap: true, wouldServe: expect.stringMatching(/Incidents/) })
    // The controls Codehouse always has are evidence even with no records.
    expect(rows.find((r) => r.control.ref === "Art. 11-12")!.evidence.map((e) => e.source)).toEqual(["kill-switch", "undo-points"])
    const md = indexMarkdown("new", "the last 90 days", rows)
    expect(md).toMatch(/^# DORA and NIS2 evidence index: new\n\n\*\*DRAFT\.\*\*/)
    expect(md).toMatch(/\| NIS2 \| Art\. 23 \| Reporting obligations for significant incidents \| \*\*Gap\*\* \|/)
    expect(md).toMatch(/## Gaps\n\n- /)
    for (const r of rows.filter((x) => x.gap)) expect(md).toContain(`- ${r.control.framework} ${r.control.ref}, ${r.control.title}: would be served by`)
  })
})
