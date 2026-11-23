// E-082: from a transcript, decisions, actions and stories with criteria go into the ledger, each linked to its line.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { extract, plan, transcriptLines, writePlan } from "../src/meeting-notes.js"
import { readRequirements } from "../src/requirements.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const VTT = [
  "WEBVTT",
  "",
  "1",
  "00:00:01.000 --> 00:00:04.000",
  "<v Priya Shah>Morning all. Decision: we ship the refund flow on Friday.</v>",
  "",
  "2",
  "00:00:05.000 --> 00:00:09.000",
  "<v Tom>As a customer, I want to see my refund status so that I stop calling support.</v>",
  "",
  "3",
  "00:00:10.000 --> 00:00:12.000",
  "<v Tom>Given a refund is approved</v>",
  "<v Tom>Then the status page shows Approved within a minute</v>",
  "",
  "4",
  "00:00:13.000 --> 00:00:15.000",
  "<v Priya Shah>Action: Tom to draft the status page copy.</v>",
  "<v Ana>I'll check the payment provider's webhook limits.</v>",
  "<v Ana>We agreed to keep the old page for a month.</v>",
  "<v Tom>As an agent I need to see the refund reason.</v>",
].join("\n")

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-meet-"))
  dirs.push(root)
  fs.mkdirSync(path.join(root, "docs", "meetings"), { recursive: true })
  fs.writeFileSync(path.join(root, "docs", "meetings", "standup.vtt"), VTT)
  return root
}

describe("meeting notes to backlog", () => {
  it("links every story, criterion, decision and action to its line", () => {
    const lines = VTT.split("\n")
    const x = extract("docs/meetings/standup.vtt", VTT)
    expect(x.stories.map((s) => s.title)).toEqual(["see my refund status", "see the refund reason"])
    for (const item of [...x.stories, ...x.stories.flatMap((s) => s.criteria), ...x.decisions, ...x.actions]) {
      expect(item.source.file).toBe("docs/meetings/standup.vtt")
      // The line on disk holds the words it was read from.
      expect(lines[item.source.line - 1]).toContain(item.source.text.replace(/^[^:]+:\s/, "").slice(0, 20))
    }
    expect(x.stories[0]!.source.line).toBe(9)
    expect(x.stories[0]!.criteria.map((c) => [c.text, c.source.line])).toEqual([
      ["Given a refund is approved", 13],
      ["Then the status page shows Approved within a minute", 14],
    ])
    expect(x.decisions.map((d) => d.text)).toEqual(["We ship the refund flow on Friday.", "Keep the old page for a month."])
    expect(x.actions).toEqual([
      expect.objectContaining({ owner: "Tom", text: "draft the status page copy." }),
      expect.objectContaining({ owner: "Ana", text: "check the payment provider's webhook limits." }),
    ])
  })

  it("puts stories in the requirement ledger as drafts linked to their lines, and the rest in a meeting record", async () => {
    const root = project()
    const x = extract("docs/meetings/standup.vtt", VTT)
    const files = plan(root, "docs/meetings/standup.vtt", x)
    expect(files.map((f) => f.file)).toEqual(["docs/requirements/REQ-see-my-refund-status.md", "docs/requirements/REQ-see-the-refund-reason.md", "docs/meetings/standup.notes.md"])
    expect(await writePlan(root, files)).toEqual({ written: files.map((f) => f.file), skipped: [] })
    const ledger = readRequirements(root)
    expect(ledger.problems).toEqual([])
    expect(ledger.requirements.map((r) => [r.id, r.status])).toEqual([
      ["REQ-see-my-refund-status", "draft"],
      ["REQ-see-the-refund-reason", "draft"],
    ])
    for (const r of ledger.requirements) expect(fs.readFileSync(path.join(root, r.file), "utf8")).toMatch(/^source: "docs\/meetings\/standup\.vtt#L\d+"$/m)
    const first = fs.readFileSync(path.join(root, ledger.requirements[0]!.file), "utf8")
    expect(first).toContain("(../meetings/standup.vtt#L9)")
    expect(first).toContain("- Given a refund is approved ([line 13](../meetings/standup.vtt#L13))")
    expect(fs.readFileSync(path.join(root, ledger.requirements[1]!.file), "utf8")).toMatch(/None were said in the meeting/)
    const record = fs.readFileSync(path.join(root, "docs/meetings/standup.notes.md"), "utf8")
    expect(record).toContain("- **Tom**: draft the status page copy. ([line 18](standup.vtt#L18))")
    // Run again: nothing already there is overwritten, and new ids do not clash.
    const again = plan(root, "docs/meetings/standup.vtt", x)
    expect(again[0]!.file).toBe("docs/requirements/REQ-see-my-refund-status-2.md")
    expect((await writePlan(root, [{ file: "docs/meetings/standup.notes.md", text: "x" }, { file: "../outside.md", text: "x" }])).skipped).toEqual(["docs/meetings/standup.notes.md", "../outside.md"])
    expect(fs.readFileSync(path.join(root, "docs/meetings/standup.notes.md"), "utf8")).toBe(record)
  })

  it("ends a story's criteria at the first line that is not one", () => {
    const x = extract("notes.txt", "As a user, I want an export so that I can share it.\nGiven a saved report\nWe should talk about lunch next.\nThen everyone left early for the day.")
    expect(x.stories[0]!.criteria.map((c) => c.text)).toEqual(["Given a saved report"])
  })

  it("reads plain text and .srt, keeping the line numbers on disk", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nDecided: use Postgres.\n"
    expect(transcriptLines(srt)).toEqual([{ line: 3, text: "Decided: use Postgres." }])
    expect(extract("notes.txt", "Hello\n\nTODO: book the room").actions).toEqual([expect.objectContaining({ text: "book the room", source: expect.objectContaining({ line: 3 }) })])
  })
})
