import { makeZip } from "./zip-fixture.js"

/**
 * Synthetic claude.ai exports in the three layouts in the owner's report (section 7.2), made from its examples. No
 * real export data is ever committed (the owner's prompt).
 */
export const ROOT = "00000000-0000-4000-8000-000000000000"

export function conversation(i: number, opts: { updated?: string; secret?: string } = {}) {
  const at = (m: number) => `2026-10-12T09:${String(10 + m).padStart(2, "0")}:00.000000Z`
  return {
    uuid: `6f1c2a9e-0000-4c1e-9a77-${String(i).padStart(12, "0")}`,
    name: `Conversation ${i}`,
    summary: "",
    created_at: at(0),
    updated_at: opts.updated ?? at(9),
    account: { uuid: "a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d" },
    chat_messages: [
      {
        uuid: `u-${i}`,
        sender: "human",
        text: "flattened",
        content: [
          {
            type: "text",
            text: `Question ${i}${opts.secret ? ` ${opts.secret}` : ""}`,
            citations: [],
          },
        ],
        attachments: [
          {
            file_name: "notes.md",
            file_size: 12,
            file_type: "text/markdown",
            extracted_content: "# Notes",
          },
        ],
        files: [{ file_name: "diagram.png", file_uuid: "9c8b7a6d-0000-4000-8000-000000000001" }],
        created_at: at(1),
        updated_at: at(1),
        parent_message_uuid: ROOT,
      },
      {
        uuid: `a-${i}`,
        sender: "assistant",
        text: "flattened",
        content: [
          { type: "thinking", thinking: "Thinking it over." },
          { type: "text", text: `First answer ${i}`, citations: [] },
        ],
        attachments: [],
        files: [],
        created_at: at(2),
        updated_at: at(2),
        parent_message_uuid: `u-${i}`,
      },
      {
        uuid: `b-${i}`,
        sender: "assistant",
        text: "flattened",
        content: [{ type: "text", text: `Second answer ${i}`, citations: [] }],
        attachments: [],
        files: [],
        created_at: at(3),
        updated_at: at(3),
        parent_message_uuid: `u-${i}`,
      },
    ],
  }
}

export const project = {
  uuid: "b7e6d5c4-b3a2-4910-8f7e-6d5c4b3a2910",
  name: "Design notes",
  description: "Notes",
  prompt_template: "Use UK English. Prefer short declarative sentences.",
  is_private: true,
  created_at: "2026-09-01T08:00:00.000000Z",
  updated_at: "2026-10-30T16:42:10.000000Z",
  docs: [
    { filename: "architecture.md", content: "# Notes", created_at: "2026-09-01T08:05:00.000000Z" },
  ],
}

export const memories = [
  {
    conversations_memory: "Prefers metric units.",
    project_memories: { [project.uuid]: "Keep answers short." },
    account_uuid: "a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d",
  },
]

const users = [{ uuid: "a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d", full_name: "Sample Person" }]
const json = (v: unknown) => JSON.stringify(v)

/** 2024 to mid-2026: conversations.json, projects.json and users.json. */
export const singleLayout = (convs = [conversation(1), conversation(2)]) =>
  makeZip([
    { name: "conversations.json", data: json(convs) },
    { name: "projects.json", data: json([project]) },
    { name: "users.json", data: json(users) },
  ])

/** August 2026: one file per project, and memories.json. */
export const perProjectLayout = () =>
  makeZip([
    { name: "conversations.json", data: json([conversation(1)]) },
    { name: "projects/", data: "" },
    { name: `projects/${project.uuid}.json`, data: json(project) },
    { name: "users.json", data: json(users) },
    { name: "memories.json", data: json(memories) },
  ])

/** October to November 2026: a manifest and one zip per category. */
export const manifestLayout = () =>
  makeZip([
    {
      name: "manifest.json",
      data: json({
        categories: ["conversations", "projects", "memories"],
        files: ["conversations-000.zip"],
      }),
    },
    {
      name: "conversations-000.zip",
      data: makeZip([{ name: "conversations.json", data: json([conversation(1)]) }]),
      method: 0,
    },
    {
      name: "projects-000.zip",
      data: makeZip([{ name: `${project.uuid}.json`, data: json(project) }]),
      method: 0,
    },
    {
      name: "memories-000.zip",
      data: makeZip([{ name: "memories.json", data: json(memories) }]),
      method: 0,
    },
  ])
