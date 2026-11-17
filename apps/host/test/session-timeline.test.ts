// O42: every ten minutes Claude sums up what each session did for its timeline. Only a session that did something is
// summed up, from redacted text; nothing is sent when it is off, for a model on this computer, for an evaluation or for
// an account that did not pass the organisation check; a failed summary leaves no node; and the record holds no words.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterAll, describe, expect, it } from "vitest"
import { linesOf, registerTimelineRoutes, SessionTimeline, type TimelineLine } from "../src/session-timeline.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-timeline-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
let n = 0

function make(o: { enabled?: boolean; local?: boolean; orgOk?: boolean; fail?: boolean } = {}) {
  const sent: Array<{ project: string; minutes: number; lines: TimelineLine[] }> = []
  const records: Array<Record<string, unknown>> = []
  const logs: string[] = []
  let clock = Date.parse("2026-11-16T10:00:00Z")
  const t = new SessionTimeline({
    dir: path.join(root, `d${++n}`),
    writer: async (input) => {
      if (o.fail) throw new Error("down")
      sent.push(input)
      return `Worked on ${input.project}.`
    },
    enabled: () => o.enabled !== false,
    session: (id) => (id === "s1" ? { project: "billing", ...(o.local ? { local: true } : {}) } : id === "eval" ? { project: "x", evaluation: true } : undefined),
    orgOk: () => o.orgOk !== false,
    redact: (s) => s.replace(/AcmeCorp/g, "[client]"),
    audit: { record: async (r) => (records.push(r as unknown as Record<string, unknown>), true) },
    policyHash: () => "h",
    log: (l) => void logs.push(l),
    now: () => clock,
  })
  return { t, sent, records, logs, advance: (ms: number) => (clock += ms) }
}

describe("a session's timeline (O42)", () => {
  it("sums up a session that did something, redacted, once, and keeps the node", async () => {
    const { t, sent, records, advance } = make()
    t.note("s1", { who: "you", text: "Add the CSV export for AcmeCorp" })
    t.message("s1", {
      type: "assistant",
      message: { content: [{ type: "text", text: "Adding it now." }, { type: "tool_use", name: "Bash", input: { command: "npm test" } }] },
    })
    advance(10 * 60_000)
    expect(await t.tick()).toBe(1)
    expect(sent[0]!.lines).toEqual([
      { who: "you", text: "Add the CSV export for [client]" },
      { who: "claude", text: "Adding it now." },
      { who: "tool", text: "Bash: npm test" },
    ])
    expect(sent[0]!.minutes).toBe(10)
    const nodes = t.list("s1")
    expect(nodes).toEqual([
      { at: "2026-11-16T10:10:00.000Z", from: "2026-11-16T10:00:00.000Z", summary: "Worked on billing.", activity: { you: 1, claude: 1, tools: 1 } },
    ])
    // Nothing new since: nothing more is written.
    expect(await t.tick()).toBe(0)
    // The record says how much, never the words.
    await new Promise((r) => setTimeout(r, 0))
    expect(records[0]).toMatchObject({ event: "timeline_summary_written", input: { lines: 3 } })
    expect(JSON.stringify(records[0])).not.toContain("CSV")
  })

  it("sends nothing when it is off, for a model on this computer, an evaluation, or an account that did not pass", async () => {
    for (const o of [{ enabled: false }, { local: true }, { orgOk: false }]) {
      const { t, sent } = make(o)
      t.note("s1", { who: "you", text: "Hello" })
      expect(await t.tick()).toBe(0)
      expect(sent).toEqual([])
      expect(t.list("s1")).toEqual([])
    }
    const { t, sent } = make()
    t.note("eval", { who: "you", text: "Hello" })
    t.note("gone", { who: "you", text: "Hello" })
    expect(await t.tick()).toBe(0)
    expect(sent).toEqual([])
  })

  it("leaves no node when the summary fails, and says why in the log", async () => {
    const { t, logs } = make({ fail: true })
    t.note("s1", { who: "you", text: "Hello" })
    expect(await t.tick()).toBe(0)
    expect(t.list("s1")).toEqual([])
    expect(logs.join("\n")).toMatch(/could not be written: down/)
  })

  it("reads Claude's words and the tools it called, and nothing from your own or other messages", () => {
    expect(linesOf({ type: "user", message: { content: "hi" } })).toEqual([])
    expect(linesOf({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } }] } })).toEqual([
      { who: "tool", text: "Read: src/a.ts" },
    ])
  })

  it("answers its summaries, and 404 for a session it never knew", async () => {
    const { t, advance } = make()
    t.note("s1", { who: "you", text: "Hello" })
    advance(60_000)
    await t.tick()
    const app = Fastify()
    registerTimelineRoutes(app, { timeline: t, enabled: () => true, exists: (id) => id === "open" })
    const r = await app.inject({ method: "GET", url: "/api/sessions/s1/timeline" })
    expect(r.json()).toMatchObject({ everyMinutes: 10, enabled: true, nodes: [{ summary: "Worked on billing." }] })
    expect((await app.inject({ method: "GET", url: "/api/sessions/open/timeline" })).json()).toMatchObject({ nodes: [] })
    expect((await app.inject({ method: "GET", url: "/api/sessions/nope/timeline" })).statusCode).toBe(404)
    await app.close()
  })
})
