// B36: a local OpenTelemetry export of decisions, off unless switched on, and never with what was said or run.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import {
  LOOPBACK_COLLECTOR,
  otlpOf,
  Telemetry,
  toolLabel,
  type TelemetrySettings,
} from "../src/telemetry.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-telemetry-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const NOW = Date.parse("2026-11-04T10:00:00Z")
const span = {
  name: "codehouse.decision",
  session: "s1",
  outcome: "allow",
  rule: "read-in-project",
  risk: 5,
  decidedBy: "rules",
  tool: "mcp__github__create_issue",
  latencyMs: 42,
}

describe("the telemetry export", () => {
  it("is a standard OTLP/JSON span that says the decision and nothing of what was run", () => {
    const body = otlpOf(span, NOW) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }>
    }
    const s = body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    expect(s.name).toBe("codehouse.decision")
    expect(String(s.traceId)).toMatch(/^[0-9a-f]{32}$/)
    expect(String(s.spanId)).toMatch(/^[0-9a-f]{16}$/)
    expect(BigInt(String(s.endTimeUnixNano)) - BigInt(String(s.startTimeUnixNano))).toBe(
      42_000_000n,
    )
    const keys = (s.attributes as Array<{ key: string }>).map((a) => a.key)
    expect(keys).toEqual([
      "codehouse.outcome",
      "codehouse.rule",
      "codehouse.risk",
      "codehouse.decided_by",
      "codehouse.tool",
    ])
    // An MCP tool keeps only its server's name.
    expect(toolLabel("mcp__github__create_issue")).toBe("mcp__github")
  })

  it("writes nothing while off, a line a day to its file when on, and sends only to a collector on this computer", () => {
    let settings: TelemetrySettings | undefined
    const fetchFn = vi.fn(async () => new Response("{}"))
    const t = new Telemetry({
      dir,
      settings: () => settings,
      fetchFn,
      log: () => undefined,
      now: () => NOW,
    })
    t.span(span)
    expect(fs.existsSync(path.join(dir, "traces-2026-11-04.jsonl"))).toBe(false)
    settings = { file: true, endpoint: "http://127.0.0.1:4318/v1/traces" }
    t.span(span)
    const lines = fs
      .readFileSync(path.join(dir, "traces-2026-11-04.jsonl"), "utf8")
      .trim()
      .split("\n")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('"stringValue":"mcp__github"')
    expect(lines[0]).not.toContain("create_issue")
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:4318/v1/traces",
      expect.objectContaining({ method: "POST" }),
    )
    // Anywhere else is never sent to, whatever the settings say.
    fetchFn.mockClear()
    settings = { endpoint: "https://collector.example.com/v1/traces" }
    t.span(span)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(
      ["http://localhost:4318/v1/traces", "http://[::1]:4318", "https://evil.example:4318"].map(
        (u) => LOOPBACK_COLLECTOR.test(u),
      ),
    ).toEqual([true, true, false])
  })
})
