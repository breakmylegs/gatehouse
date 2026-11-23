// E-062: a fixture epic yields ledger stories with stable ids and criteria, dependencies by id, and estimates from
// history where there is enough.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { epicKey, estimateLine, storyId, writeStories, type StoryInput } from "../src/epic.js"
import { readRequirements } from "../src/requirements.js"
import { check } from "../src/task-results.js"
import { STORY_SCHEMA } from "../src/epic.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const root = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-epic-"))
  dirs.push(d)
  return d
}

const stories: StoryInput[] = [
  { title: "Customers can see their order history", story: "As a customer, I want to see my orders, so that I can track them.", criteria: ["When a signed-in customer opens Orders, the system shall list their orders newest first."] },
  { title: "Customers can cancel an unshipped order", criteria: ["When a customer cancels an unshipped order, the system shall refund it."], dependsOn: ["Customers can see their order history"] },
]

describe("epic decomposition", () => {
  it("writes stories into the ledger with stable ids, criteria and dependencies by id", () => {
    const r = root()
    const out = writeStories(r, "Order self service", stories)
    const [a, b] = out
    expect(a!.id).toMatch(/^OSS-[0-9A-F]{4}$/)
    expect(b!.dependsOn).toEqual([a!.id])
    const { requirements, problems } = readRequirements(r)
    expect(problems).toEqual([])
    expect(requirements.map((q) => q.id).sort()).toEqual([a!.id, b!.id].sort())
    const text = fs.readFileSync(path.join(r, a!.file), "utf8")
    expect(text).toContain("## Acceptance criteria\n\n- When a signed-in customer opens Orders")
    expect(text).toContain("status: proposed")
  })

  it("keeps each id when the epic is decomposed again, in another order, and does not overwrite a story", () => {
    const r = root()
    const first = writeStories(r, "Order self service", stories)
    fs.appendFileSync(path.join(r, first[0]!.file), "\nEdited by a person.\n")
    const again = writeStories(r, "Order self service", [...stories].reverse())
    expect(again.map((s) => s.id).sort()).toEqual(first.map((s) => s.id).sort())
    expect(again.every((s) => !s.written)).toBe(true)
    expect(fs.readFileSync(path.join(r, first[0]!.file), "utf8")).toContain("Edited by a person.")
    expect(storyId("Order self service", "Customers can see their order history!")).toBe(first[0]!.id)
  })

  it("gives an estimate from history only with enough samples", () => {
    expect(estimateLine({ samples: 12, enough: true, costUsd: { low: 0.4, median: 0.9, high: 2.5 }, minutes: { low: 6, median: 14, high: 40 } })).toBe("About $0.40 to $2.50 per change, 6 to 40 minutes, from 12 samples of this project's history.")
    expect(estimateLine({ samples: 3, enough: false })).toBe("Not enough history for an estimate yet (3 samples; five are needed).")
    // Figures from too few samples are not shown as an estimate.
    expect(estimateLine({ samples: 3, enough: false, costUsd: { low: 1, median: 2, high: 3 } })).toMatch(/^Not enough history/)
    const r = root()
    writeStories(r, "X", stories.slice(0, 1), { samples: 12, enough: true, costUsd: { low: 1, median: 2, high: 3 } })
    expect(fs.readFileSync(path.join(r, "docs", "requirements", `${storyId("X", stories[0]!.title)}.md`), "utf8")).toContain("About $1.00 to $3.00 per change")
  })

  it("names the epic's key from its words, and checks Claude's result against the story schema", () => {
    expect(epicKey("Order self service")).toBe("OSS")
    expect(epicKey("--")).toBe("EPIC")
    expect(check({ stories }, STORY_SCHEMA as never)).toMatchObject({ ok: true })
    expect(check({ stories: [{ title: "x" }] }, STORY_SCHEMA as never)).toMatchObject({ ok: false })
  })
})
