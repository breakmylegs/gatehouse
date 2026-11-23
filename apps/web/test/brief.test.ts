// E-087: every option of a decision brief cites a source from the Sources pane; one that does not, or cites a number
// the pane does not have, is named for Claude to fix.
import { describe, expect, it } from "vitest"
import { briefPrompt, checkBrief, fixPrompt, latestBrief } from "../src/lib/brief"
import type { Source } from "../src/lib/sources"
import type { Item } from "../src/lib/transcript"

const SOURCES = [
  { n: 1, title: "Postgres partitioning guide", url: "https://example.org/pg" },
  { n: 2, title: "Cost of managed clusters", url: "https://example.org/cost" },
] as unknown as Source[]

const BRIEF = `## Context
We need to keep five years of orders.

## Options

### Option 1: Partition the table
Monthly partitions. Sources: [1]

### Option 2: Move to a managed cluster
Costs more [2] and [7].

### Option 3: Do nothing
No change.

## Risks
Migration time.

## Recommendation
Option 1, as the guide shows [1].
`

describe("research to decision brief", () => {
  it("asks for the shape, listing the pane's sources by their numbers", () => {
    const p = briefPrompt(SOURCES)
    for (const s of ["## Context", "## Options", "## Risks", "## Recommendation"]) expect(p).toContain(s)
    expect(p).toContain("[1] Postgres partitioning guide (https://example.org/pg)")
    expect(p).toContain("[2] Cost of managed clusters")
  })

  it("checks every option cites a source from the pane, and names what does not", () => {
    const c = checkBrief(BRIEF, SOURCES)
    expect(c.options).toEqual([
      { name: "Option 1: Partition the table", cites: [1], unknown: [], ok: true },
      { name: "Option 2: Move to a managed cluster", cites: [2], unknown: [7], ok: true },
      { name: "Option 3: Do nothing", cites: [], unknown: [], ok: false },
    ])
    expect(c.ok).toBe(false)
    const fix = fixPrompt(c)
    expect(fix).toContain('Option "Option 3: Do nothing" cites no source from the Sources pane.')
    expect(fix).toContain('Option "Option 2: Move to a managed cluster" also cites [7], which the pane does not have.')
    const good = BRIEF.replace("No change.", "No change; the guide says the table copes [1].")
    expect(checkBrief(good, SOURCES).ok).toBe(true)
    // Every option cited but a section missing is not a brief to use.
    expect(checkBrief(good.replace("## Risks\nMigration time.\n", ""), SOURCES)).toMatchObject({ ok: false, missingSections: ["Risks"] })
  })

  it("counts a citation the pane does not have as no source, and wants every section", () => {
    const c = checkBrief("## Options\n\n### Option A\nSee [9].\n", SOURCES)
    expect(c.options[0]).toMatchObject({ ok: false, unknown: [9] })
    expect(c.missingSections).toEqual(["Context", "Risks", "Recommendation"])
    expect(fixPrompt(c)).toContain("(it cites [9], which the pane does not have)")
    expect(checkBrief("Just an answer.", SOURCES)).toMatchObject({ isBrief: false, ok: false })
  })

  it("finds the latest answer that is a brief, and not one from before your last message", () => {
    const items = [
      { id: "1", kind: "text", text: BRIEF },
      { id: "2", kind: "user", text: "thanks" },
      { id: "3", kind: "text", text: "You are welcome." },
    ] as unknown as Item[]
    expect(latestBrief(items)).toBeUndefined()
    expect(latestBrief(items.slice(0, 1))).toBe(BRIEF)
  })
})
