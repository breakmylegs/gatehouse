import { describe, expect, it } from "vitest"
import { addSystem, addUser, emptyTranscript, MAX_ITEMS, reduce } from "../src/lib/transcript"

const assistant = (content: unknown[], extra: object = {}) => ({
  type: "assistant",
  message: { content },
  ...extra,
})

describe("transcript reducer", () => {
  it("collects text, thinking and tool calls in order", () => {
    let t = emptyTranscript()
    t = reduce(
      t,
      assistant([
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "Hello" },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ]),
    )
    expect(t.items.map((i) => i.kind)).toEqual(["thinking", "text", "tool"])
  })
  it("attaches a tool result to its call, including errors and mixed content", () => {
    let t = reduce(
      emptyTranscript(),
      assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
    )
    t = reduce(t, {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: [{ type: "text", text: "boom" }, { type: "image" }],
          },
        ],
      },
    })
    const tool = t.items[0]
    expect(tool).toMatchObject({ kind: "tool", result: { isError: true, text: "boom\n[image]" } })
  })
  it("ignores a result for an unknown call and leaves the transcript the same object", () => {
    const t = reduce(
      emptyTranscript(),
      assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
    )
    expect(
      reduce(t, {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "zzz", content: "x" }] },
      }),
    ).toBe(t)
  })
  it("keeps the todo list from the latest TodoWrite and tolerates bad statuses", () => {
    let t = reduce(
      emptyTranscript(),
      assistant([
        {
          type: "tool_use",
          id: "a",
          name: "TodoWrite",
          input: {
            todos: [
              { content: "one", status: "completed" },
              { content: "two", status: "weird" },
            ],
          },
        },
      ]),
    )
    expect(t.todos).toEqual([
      { content: "one", status: "completed" },
      { content: "two", status: "pending" },
    ])
    t = reduce(t, assistant([{ type: "text", text: "more" }]))
    expect(t.todos.length).toBe(2)
  })
  it("records the end of a turn and marks subagent text", () => {
    let t = reduce(emptyTranscript(), {
      type: "result",
      subtype: "success",
      result: "All done",
      total_cost_usd: 0.5,
      num_turns: 3,
    })
    expect(t.items[0]).toMatchObject({ kind: "result", isError: false, costUsd: 0.5, turns: 3 })
    t = reduce(t, { type: "result", subtype: "error_max_turns" })
    expect(t.items[1]).toMatchObject({ isError: true })
    t = reduce(t, assistant([{ type: "text", text: "inner" }], { parent_tool_use_id: "p1" }))
    expect(t.items[2]).toMatchObject({ kind: "text", subagent: "p1" })
  })
  it("never throws on messages it does not understand", () => {
    const t = emptyTranscript()
    for (const m of [
      null,
      undefined,
      5,
      "x",
      [],
      {},
      { type: "assistant" },
      { type: "assistant", message: { content: "text" } },
      { type: "user", message: {} },
      { type: "system" },
    ])
      expect(() => reduce(t, m)).not.toThrow()
  })
  it("caps the transcript at MAX_ITEMS", () => {
    let t = emptyTranscript()
    for (let i = 0; i < MAX_ITEMS + 50; i++) t = addSystem(t, `s${i}`)
    expect(t.items.length).toBe(MAX_ITEMS)
    expect(t.items.at(-1)).toMatchObject({ text: `s${MAX_ITEMS + 49}` })
    expect(addUser(t, "hi").items.at(-1)).toMatchObject({ kind: "user", text: "hi" })
  })
})
