// T-018 and T-019 (t3code review): a session's title written by Claude, with the recap's limits: no tools, Manual
// mode, no credential, redacted input, recorded first without its words, never for a model on this computer or an
// account that failed the organisation check. Your instructions for titles reach the writer.
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import type { HostAudit } from "../src/hostaudit.js"
import { registerTitleRoutes, type TitleDeps } from "../src/title-api.js"
import { cleanTitle, createTitleWriter, TITLE_SYSTEM } from "../src/title-writer.js"

function setup(over: Partial<TitleDeps> = {}) {
  const records: Array<Record<string, unknown>> = []
  const writer = vi.fn(async () => "Falcon login page")
  const app = Fastify()
  registerTitleRoutes(app, {
    writer,
    enabled: () => true,
    instructions: () => "Start with the ticket number",
    session: (id) => (id === "s1" ? { project: "shop" } : id === "local" ? { project: "x", local: true } : undefined),
    orgOk: () => true,
    redact: (t) => t.replace(/Falcon/g, "[redacted]"),
    audit: { record: async (r: Record<string, unknown>) => (records.push(r), true) } as unknown as HostAudit,
    policyHash: () => "h",
    ...over,
  })
  const ask = (session = "s1") =>
    app.inject({
      method: "POST",
      url: "/api/title",
      payload: { session, lines: [{ who: "you", text: "Build the Falcon login page" }, { who: "claude", text: "On it." }] },
    })
  return { ask, writer, records }
}

describe("session titles by Claude (T-018, T-019)", () => {
  it("names it from the first exchange, redacted, with your instructions, recorded without its words", async () => {
    const t = setup()
    expect((await t.ask()).json()).toEqual({ title: "Falcon login page" })
    const input = (t.writer.mock.calls[0] as unknown[])[0] as { lines: Array<{ text: string }>; instructions: string }
    expect(input.lines[0]!.text).toBe("Build the [redacted] login page")
    expect(input.instructions).toBe("Start with the ticket number")
    expect(t.records).toEqual([expect.objectContaining({ event: "title_written", input: { lines: 2, chars: 37 } })])
    expect(JSON.stringify(t.records)).not.toContain("login")
  })

  it("asks nothing when off, for a model on this computer, a failed organisation check, or when it cannot record", async () => {
    for (const [over, session, why] of [
      [{ enabled: () => false }, "s1", "off"],
      [{}, "local", "local"],
      [{ orgOk: () => false }, "s1", "account"],
      [{ audit: { record: async () => false } as unknown as HostAudit }, "s1", "audit"],
    ] as const) {
      const t = setup(over)
      expect((await t.ask(session)).json(), why).toEqual({ skipped: why })
      expect(t.writer, why).not.toHaveBeenCalled()
    }
  })

  it("writes with no tools, in Manual mode, without a credential, and cleans what comes back", async () => {
    let options: Record<string, unknown> = {}
    const write = createTitleWriter({
      env: { ANTHROPIC_API_KEY: "sk-ant-x", PATH: "C:/x" },
      queryFn: (p) => {
        options = p.options
        return (async function* () {
          yield { type: "result", subtype: "success", structured_output: { title: ' "Fix the login page." ' } }
        })()
      },
    })
    expect(await write({ project: "shop", lines: [{ who: "you", text: "x" }], instructions: "Short" })).toBe(
      "Fix the login page",
    )
    expect(options).toMatchObject({ tools: [], permissionMode: "default", maxTurns: 1, settingSources: [] })
    expect(options.systemPrompt).toBe(`${TITLE_SYSTEM}\nThe person asks, for their titles: Short`)
    expect((options.env as Record<string, string>).ANTHROPIC_API_KEY).toBeUndefined()
    expect(await (options.canUseTool as () => Promise<{ behavior: string }>)()).toMatchObject({ behavior: "deny" })
    expect(cleanTitle("a\nb".repeat(40)).length).toBeLessThanOrEqual(60)
  })
})
