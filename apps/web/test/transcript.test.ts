import { describe, expect, it } from "vitest"
import {
  addSystem,
  addUser,
  emptyTranscript,
  markStopping,
  MAX_ITEMS,
  reduce,
  reduceHistory,
  splitPictures,
  type Item,
} from "../src/lib/transcript"

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
  it("says a turn you stopped was stopped, not that it failed", () => {
    const failed = { type: "result", subtype: "error_during_execution", is_error: true }
    // The Host says it is stopping the turn before the result arrives; text from the turn still lands.
    let t = markStopping(emptyTranscript(), "you")
    t = reduce(t, assistant([{ type: "text", text: "half way" }]))
    t = reduce(t, failed)
    expect(t.items[1]).toMatchObject({
      kind: "result",
      text: "You stopped this turn.",
      isError: false,
      stopped: true,
    })
    // Only that turn: the next failure is an error again, and says so without repeating itself.
    t = reduce(t, failed)
    expect(t.items[2]).toMatchObject({ text: "Claude Code did not say why.", isError: true })
    expect(reduce(t, { type: "result", subtype: "error_max_turns" }).items[3]).toMatchObject({
      text: "Claude reached the most steps a turn may take.",
    })
    expect(reduce(markStopping(t, "kill-switch"), failed).items.at(-1)).toMatchObject({
      text: "The kill switch stopped this turn.",
      isError: false,
    })
    // A turn that finished just before the stop: your next message clears it.
    expect(addUser(markStopping(t, "you"), "next").stopping).toBeUndefined()
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

describe("pictures in the transcript", () => {
  const png = "iVBORw0KGgo="
  it("keeps a picture a tool gave back, named by the file it read, and leaves it out of the words", () => {
    let t = reduce(
      emptyTranscript(),
      assistant([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "C:\\p\\shot.png" } }]),
    )
    t = reduce(t, {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
              { type: "text", text: "Captured." },
            ],
          },
        ],
      },
    })
    expect(t.items[0]).toMatchObject({
      kind: "tool",
      result: { text: "Captured.", images: [{ name: "shot.png", url: `data:image/png;base64,${png}` }] },
    })
  })

  it("names any other tool's picture as a capture, takes the MCP shape too, and never shows a type it should not", () => {
    let t = reduce(
      emptyTranscript(),
      assistant([{ type: "tool_use", id: "t1", name: "mcp__browser__capture", input: {} }]),
    )
    t = reduce(t, {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              { type: "image", data: png, mimeType: "image/jpeg" },
              { type: "image", source: { type: "base64", media_type: "image/svg+xml", data: png } },
            ],
          },
        ],
      },
    })
    const r = (t.items[0] as Extract<Item, { kind: "tool" }>).result
    expect(r?.images).toEqual([{ name: "Picture Claude captured", url: `data:image/jpeg;base64,${png}` }])
    expect(r?.text).toBe("[image]")
  })

  it("shows a picture you attached as a picture again when the conversation is read back", () => {
    const t = reduceHistory(emptyTranscript(), {
      type: "user",
      message: { content: "What is wrong here?\n\n@.jcvc/attachments/0a1b2c-image.png @docs/flow.png" },
    })
    expect(t.items[0]).toEqual(
      expect.objectContaining({
        kind: "user",
        text: "What is wrong here?",
        images: [
          { path: ".jcvc/attachments/0a1b2c-image.png", name: "Pasted picture" },
          { path: "docs/flow.png", name: "flow.png" },
        ],
      }),
    )
  })

  it("leaves a mention outside the folder, or of something that is not a picture, as words", () => {
    for (const said of ["see @../secret.png", "see @C:/Users/x/a.png", "see @notes.md", "mail a@b.png"])
      expect(splitPictures(said)).toEqual({ text: said, images: [] })
  })
})
