// While you were away, written by Claude in plain English (owner, 4 Nov).
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import type { HostAudit } from "../src/hostaudit.js"
import { registerRecapRoutes, type RecapDeps } from "../src/recap-api.js"
import { createRecapWriter, RECAP_CHARS, recapPrompt } from "../src/recap-writer.js"

function setup(over: Partial<RecapDeps> = {}) {
  const records: Array<Record<string, unknown>> = []
  const writer = vi.fn(async () => "Claude finished the login page. The tests still need fixing.")
  const app = Fastify()
  registerRecapRoutes(app, {
    writer,
    enabled: () => true,
    session: (id) =>
      id === "s1"
        ? { project: "shop" }
        : id === "local"
          ? { project: "x", local: true }
          : undefined,
    orgOk: () => true,
    redact: (t) => t.replace(/Falcon/g, "[redacted]"),
    audit: {
      record: async (r: Record<string, unknown>) => (records.push(r), true),
    } as unknown as HostAudit,
    policyHash: () => "h",
    ...over,
  })
  const ask = (body: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/api/recap",
      payload: {
        session: "s1",
        since: 1000,
        minutes: 52,
        state: "still working",
        waiting: 0,
        lines: [
          { who: "you", text: "Build the Falcon login page" },
          { who: "claude", text: "Done. The tests are failing." },
        ],
        ...body,
      },
    })
  return { app, ask, writer, records }
}

describe("While you were away, in plain English", () => {
  it("has Claude sum up what was said, redacted first, and audits it without its words", async () => {
    const t = setup()
    expect((await t.ask()).json()).toEqual({
      summary: "Claude finished the login page. The tests still need fixing.",
    })
    const input = (t.writer.mock.calls[0] as unknown[])[0] as { lines: Array<{ text: string }> }
    expect(input.lines[0]!.text).toBe("Build the [redacted] login page")
    expect(t.records).toHaveLength(1)
    expect(t.records[0]).toMatchObject({ event: "recap_written", input: { lines: 2 } })
    expect(JSON.stringify(t.records)).not.toContain("login page")
    // The same absence is written once.
    await t.ask()
    expect(t.writer).toHaveBeenCalledTimes(1)
    await t.app.close()
  })

  it("sends nothing when it is turned off, for a model on this computer, or when the account is not confirmed", async () => {
    for (const [over, body, reason] of [
      [{ enabled: () => false }, {}, "off"],
      [{}, { session: "local" }, "local"],
      [{ orgOk: () => false }, {}, "account"],
      [{}, { lines: [{ who: "you", text: "   " }] }, "nothing"],
    ] as const) {
      const t = setup(over)
      expect((await t.ask(body)).json()).toEqual({ skipped: reason })
      expect(t.writer).not.toHaveBeenCalled()
      await t.app.close()
    }
  })

  it("keeps the screen's own list when Claude cannot write it, and tries again next time", async () => {
    const writer = vi.fn(async () => {
      throw new Error("no network")
    })
    const t = setup({ writer })
    expect((await t.ask()).json()).toEqual({ skipped: "failed" })
    await t.ask()
    expect(writer).toHaveBeenCalledTimes(2)
    expect((await t.ask({ session: "nobody" })).statusCode).toBe(404)
    await t.app.close()
  })

  it("reads the latest part of a long absence, and asks with no tools in Manual mode", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({
      who: "claude" as const,
      text: `step ${i} ${"x".repeat(500)}`,
    }))
    const prompt = recapPrompt({
      project: "shop",
      minutes: 60,
      state: "still working",
      waiting: 2,
      lines,
    })
    expect(prompt).toContain("step 49")
    expect(prompt).not.toContain("step 0 ")
    expect(prompt.length).toBeLessThan(RECAP_CHARS + 500)
    expect(prompt).toContain("with 2 requests waiting on them")
    let options: Record<string, unknown> = {}
    const write = createRecapWriter({
      env: { ANTHROPIC_API_KEY: "sk-ant-x", PATH: "C:/x" },
      queryFn: (p) => {
        options = p.options
        return (async function* () {
          yield {
            type: "result",
            subtype: "success",
            structured_output: { summary: " All done. " },
          }
        })()
      },
    })
    expect(await write({ project: "shop", minutes: 1, state: "finished", waiting: 0, lines })).toBe(
      "All done.",
    )
    expect(options).toMatchObject({
      tools: [],
      permissionMode: "default",
      maxTurns: 1,
      settingSources: [],
    })
    expect((options.env as Record<string, string>).ANTHROPIC_API_KEY).toBeUndefined()
    expect(await (options.canUseTool as () => Promise<{ behavior: string }>)()).toMatchObject({
      behavior: "deny",
    })
  })
})
