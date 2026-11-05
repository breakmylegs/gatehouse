// CH-04: how a claude.ai export's records become Chat's own (the owner's report, sections 7.3 to 7.6; synthetic data).
import { describe, expect, it } from "vitest"
import {
  kindOf,
  mapBlock,
  mapConversation,
  mapMemories,
  mapProject,
  ROOT,
} from "../src/chat/import/map.js"

const msg = (
  uuid: string,
  parent: string,
  sender: "human" | "assistant",
  at: string,
  content: unknown[],
  extra = {},
) => ({
  uuid,
  sender,
  text: "flattened",
  content,
  attachments: [],
  files: [],
  created_at: at,
  updated_at: at,
  parent_message_uuid: parent,
  ...extra,
})
const text = (t: string) => ({ type: "text", text: t, citations: [] })

const conversation = {
  uuid: "6f1c2a9e-3b4d-4c1e-9a77-1d2e3f4a5b6c",
  name: "Permission model",
  summary: "",
  created_at: "2026-10-12T09:14:03.120455Z",
  updated_at: "2026-10-12T09:31:47.902114Z",
  account: { uuid: "a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d" },
  unknown_field: { kept: true },
  chat_messages: [
    msg("u1", ROOT, "human", "2026-10-12T09:14:03Z", [text("Review the attached approval flow.")], {
      attachments: [
        {
          file_name: "approval-flow.md",
          file_size: 2048,
          file_type: "text/markdown",
          extracted_content: "# Approval flow",
        },
      ],
      files: [{ file_name: "diagram.png", file_uuid: "9c8b7a6d-0000-4000-8000-000000000001" }],
    }),
    msg("a1", "u1", "assistant", "2026-10-12T09:14:19Z", [
      { type: "thinking", thinking: "Check where approvals are cached..." },
      text("The flow has two gaps..."),
      {
        type: "tool_use",
        name: "artifacts",
        input: { id: "plan", title: "Plan", type: "text/markdown", content: "v1" },
      },
      { type: "token_budget" },
    ]),
    // Asked again: a second answer under the same message, made later, is the one shown.
    msg("a2", "u1", "assistant", "2026-10-12T09:20:00Z", [
      text("Second answer."),
      {
        type: "tool_use",
        name: "artifacts",
        input: { id: "plan", command: "rewrite", content: "v2" },
      },
      { type: "hologram", glow: 3 },
    ]),
    msg("u2", "a2", "human", "2026-10-12T09:21:00Z", [text("Thanks")]),
    // A second root, older, and a message whose parent is not in the export.
    msg("r2", ROOT, "human", "2026-10-12T09:00:00Z", [text("Earlier start")]),
    msg("orphan", "missing-parent", "assistant", "2026-10-12T09:30:00Z", [text("Lost parent")]),
    // Not a message anyone sent.
    msg("odd", "u1", "system" as "human", "2026-10-12T09:22:00Z", [text("x")]),
  ],
}

describe("reading a claude.ai conversation", () => {
  it("keeps who said what, as user and assistant, with each kind of block", () => {
    const c = mapConversation(conversation)
    if ("why" in c) throw new Error(c.why)
    expect(c.title).toBe("Permission model")
    const u1 = c.messages.find((m) => m.sourceUuid === "u1")!
    expect(u1).toMatchObject({ role: "user", parentSourceUuid: null })
    expect(u1.attachments).toEqual([
      {
        fileName: "approval-flow.md",
        fileType: "text/markdown",
        size: 2048,
        text: "# Approval flow",
        included: true,
      },
      { fileName: "diagram.png", included: false },
    ])
    const a1 = c.messages.find((m) => m.sourceUuid === "a1")!
    expect(a1.role).toBe("assistant")
    expect(a1.blocks.map((b) => b.type)).toEqual(["thinking", "text", "tool_use"])
    const a2 = c.messages.find((m) => m.sourceUuid === "a2")!
    expect(a2.blocks.at(-1)).toMatchObject({ type: "other", kind: "hologram" })
    expect(c.messages.some((m) => m.sourceUuid === "odd")).toBe(false)
    expect(c.raw).toMatchObject({ unknown_field: { kept: true } })
  })

  it("rebuilds the tree: the root sentinel, two roots, a lost parent, and the newest answer at each fork shown", () => {
    const c = mapConversation(conversation)
    if ("why" in c) throw new Error(c.why)
    const roots = c.messages.filter((m) => m.parentSourceUuid === null).map((m) => m.sourceUuid)
    expect(roots.sort()).toEqual(["orphan", "r2", "u1"])
    // The newest root is the lost one, which has no children; the shown branch starts there.
    expect(c.activeLeaf).toBe("orphan")
    const without = mapConversation({
      ...conversation,
      chat_messages: conversation.chat_messages.filter((m) => m.uuid !== "orphan"),
    })
    if ("why" in without) throw new Error(without.why)
    expect(without.activeLeaf).toBe("u2")
  })

  it("keeps each artifact's versions in the order they were made", () => {
    const c = mapConversation(conversation)
    if ("why" in c) throw new Error(c.why)
    expect(c.artifacts).toEqual([
      {
        key: "plan",
        title: "Plan",
        type: "text/markdown",
        versions: [
          { content: "v1", createdAt: "2026-10-12T09:14:19.000Z", messageSourceUuid: "a1" },
          { content: "v2", createdAt: "2026-10-12T09:20:00.000Z", messageSourceUuid: "a2" },
        ],
      },
    ])
  })

  it("skips a record without what it must have, and says why", () => {
    expect(mapConversation({ name: "no uuid" })).toEqual({
      what: "a conversation",
      why: "it has no uuid",
    })
    expect(mapConversation({ uuid: "x", created_at: "not a date" })).toMatchObject({
      why: "it has no date it was made",
    })
    expect(mapProject({})).toMatchObject({ why: "it has no uuid" })
    expect(mapBlock("not an object")).toBeUndefined()
  })
})

describe("reading projects and memory", () => {
  it("keeps a project's instructions and documents, to be accepted before they are used", () => {
    const p = mapProject({
      uuid: "b7e6",
      name: "Design notes",
      description: "Notes",
      prompt_template: "Use UK English.",
      docs: [{ filename: "architecture.md", content: "# Notes" }],
      created_at: "2026-09-01T08:00:00Z",
      updated_at: "2026-10-30T16:42:10Z",
    })
    expect(p).toMatchObject({
      sourceUuid: "b7e6",
      instructions: "Use UK English.",
      docs: [{ fileName: "architecture.md", text: "# Notes" }],
    })
  })

  it("reads memory for every chat and for each project", () => {
    expect(
      mapMemories([
        {
          conversations_memory: "Prefers metric.",
          project_memories: { b7e6: "Short answers." },
          account_uuid: "a",
        },
      ]),
    ).toEqual([
      { scope: "global", text: "Prefers metric." },
      { scope: { projectSourceUuid: "b7e6" }, text: "Short answers." },
    ])
  })

  it("tells what a file holds from what is in it, not its name", () => {
    expect(kindOf([conversation])).toBe("conversations")
    expect(kindOf([{ uuid: "p", prompt_template: "" }])).toBe("projects")
    expect(kindOf({ uuid: "p", prompt_template: "" })).toBe("project")
    expect(kindOf([{ conversations_memory: "" }])).toBe("memories")
    expect(kindOf({ hello: 1 })).toBeUndefined()
  })
})
