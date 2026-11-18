// E-052: a side task's result is checked against the JSON Schema it was given before it reaches the session that
// asked: an invalid one is refused with its errors and sent back once, then the task fails; a valid one arrives with
// the side session's taint; and a schema that cannot be used is refused before anything starts.
import { describe, expect, it } from "vitest"
import { lastJson, readSchema, resultInstruction, TaskResults } from "../src/task-results.js"

const schema = { type: "object", properties: { files: { type: "array", items: { type: "string" } }, count: { type: "integer" } }, required: ["files", "count"] }

describe("structured task results (E-052)", () => {
  it("refuses an invalid result with its errors, sends it back once, then fails the task", async () => {
    const t = new TaskResults()
    t.expect("child", schema)
    const sent: string[] = []
    const first = await t.finished("child", 'Done.\n```json\n{"files": ["a.ts"], "count": "two"}\n```', "none", (p) => sent.push(p))
    expect(first).toMatchObject({ isError: true })
    expect(first!.text).toMatch(/count/)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/did not match the JSON Schema/)
    const second = await t.finished("child", '```json\n{"files": "a.ts"}\n```', "none", (p) => sent.push(p))
    expect(second).toMatchObject({ isError: true })
    expect(second!.text).toMatch(/failed/)
    expect(sent).toHaveLength(1)
  })

  it("hands over a valid result with the side session's taint", async () => {
    const t = new TaskResults()
    t.expect("child", schema)
    const r = await t.finished("child", 'Here it is:\n```json\n{"files": ["a.ts", "b.ts"], "count": 2}\n```', "untrusted", () => undefined)
    expect(r!.isError).toBeUndefined()
    expect(r!.text).toMatch(/matches its schema/)
    expect(r!.text).toMatch(/read untrusted content/)
    expect(r!.text).toContain('"count": 2')
    // Handed over once: the task is done.
    expect(t.has("child")).toBe(false)
  })

  it("reads the last JSON block, refuses a schema it cannot use, and tells the side session the shape", () => {
    expect(lastJson('first ```json\n{"a":1}\n``` then ```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(lastJson('the answer is {"a": 3}')).toEqual({ a: 3 })
    expect(lastJson("no json here")).toBeUndefined()
    expect(readSchema("not json")).toMatch(/not JSON/)
    expect(readSchema("[1, 2]")).toMatch(/JSON Schema object/)
    const ok = readSchema(JSON.stringify(schema))
    expect(typeof ok).toBe("object")
    expect(resultInstruction((ok as { text: string }).text)).toMatch(/one JSON code block/)
  })

  it("leaves a task with no schema alone", async () => {
    expect(await new TaskResults().finished("x", "anything", "none", () => undefined)).toBeUndefined()
  })
})
