// /btw (owner, 4 Nov, for a colleague): a side question about a session, answered without interrupting it.
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import {
  BTW_CHARS,
  btwPrompt,
  createBtwWriter,
  registerBtwRoutes,
  type BtwDeps,
} from "../src/btw.js"
import type { HostAudit } from "../src/hostaudit.js"

function setup(over: Partial<BtwDeps> = {}) {
  const records: Array<Record<string, unknown>> = []
  const writer = vi.fn(
    async () => "It has finished the login page and is fixing two failing tests.",
  )
  const app = Fastify()
  registerBtwRoutes(app, {
    writer,
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
      url: "/api/btw",
      payload: {
        session: "s1",
        question: "How far has it got with Falcon?",
        lines: [
          { who: "you", text: "Build the Falcon login page" },
          { who: "claude", text: "Done. Two tests fail." },
        ],
        ...body,
      },
    })
  return { app, ask, writer, records }
}

describe("a side question with /btw", () => {
  it("answers from what was said, redacted first, and is audited without its words", async () => {
    const t = setup()
    expect((await t.ask()).json()).toEqual({
      answer: "It has finished the login page and is fixing two failing tests.",
    })
    const input = (t.writer.mock.calls[0] as unknown[])[0] as {
      question: string
      lines: Array<{ text: string }>
    }
    expect(input.question).toBe("How far has it got with [redacted]?")
    expect(input.lines[0]!.text).toBe("Build the [redacted] login page")
    expect(t.records[0]).toMatchObject({
      event: "side_question",
      verdict: { ruleId: "side-question" },
    })
    expect(JSON.stringify(t.records)).not.toContain("login page")
    await t.app.close()
  })

  it("sends nothing for a model on this computer, or when the account is not confirmed", async () => {
    for (const [over, body] of [
      [{}, { session: "local" }],
      [{ orgOk: () => false }, {}],
    ] as const) {
      const t = setup(over)
      expect((await t.ask(body)).statusCode).toBe(422)
      expect(t.writer).not.toHaveBeenCalled()
      await t.app.close()
    }
  })

  it("asks with no tools, in Manual mode, reading the latest part of a long session", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({
      who: "claude" as const,
      text: `step ${i} ${"x".repeat(500)}`,
    }))
    const prompt = btwPrompt({ project: "shop", question: "Where is it?", lines })
    expect(prompt).toContain("step 79")
    expect(prompt).not.toContain("step 0 ")
    expect(prompt.length).toBeLessThan(BTW_CHARS + 500)
    expect(prompt.endsWith("The side question: Where is it?")).toBe(true)
    let options: Record<string, unknown> = {}
    const write = createBtwWriter({
      env: { ANTHROPIC_API_KEY: "sk-ant-x" },
      queryFn: (p) => {
        options = p.options
        return (async function* () {
          yield {
            type: "result",
            subtype: "success",
            structured_output: { answer: " Nearly done. " },
          }
        })()
      },
    })
    expect(await write({ project: "shop", question: "?", lines })).toBe("Nearly done.")
    expect(options).toMatchObject({
      tools: [],
      permissionMode: "default",
      maxTurns: 1,
      settingSources: [],
    })
    expect((options.env as Record<string, string>).ANTHROPIC_API_KEY).toBeUndefined()
  })
})
