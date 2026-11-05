// @vitest-environment jsdom
// CH-05 (owner's Chat build): an imported claude.ai chat, drawn like a native one, read only.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { toItems, toMarkdown, type StoredStep } from "../src/lib/imported"

const saved: Array<{ name: string; text: string; type?: string }> = []
vi.mock("../src/lib/exportMarkdown", async (orig) => ({
  ...(await orig<typeof import("../src/lib/exportMarkdown")>()),
  download: (name: string, text: string, type?: string) => saved.push({ name, text, type }),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("react-virtuoso", () => ({ Virtuoso: () => null }))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const step = (
  id: string,
  role: "user" | "assistant",
  blocks: StoredStep["message"]["blocks"],
  index = 0,
  siblings = [id],
  redactions = 0,
): StoredStep => ({
  message: { id, role, createdAt: "2026-10-12T09:14:00Z", blocks, redactions },
  index,
  siblings,
})
const steps: StoredStep[] = [
  step("u1", "user", [{ type: "text", text: "Review the flow." }], 0, ["u1"], 1),
  step(
    "a2",
    "assistant",
    [
      { type: "thinking", text: "Check the cache." },
      { type: "text", text: "Second answer." },
      { type: "tool_use", name: "web_search", input: { query: "approvals" }, cloud: true },
      { type: "tool_result", text: "Three results." },
      { type: "file", kind: "image", fileUuid: "f1" },
      { type: "other", kind: "hologram", raw: {} },
    ],
    1,
    ["a1", "a2"],
  ),
]

let api = vi.fn()
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }))
afterEach(() => {
  cleanup()
  saved.length = 0
})

describe("an imported chat as items", () => {
  it("reads like a native chat: words, folded thinking, tool calls with results, and what the export left out", () => {
    const items = toItems(steps, {
      u1: [
        { fileName: "notes.md", fileType: null, size: 12, text: "# Notes", included: true },
        { fileName: "diagram.png", fileType: null, size: null, text: null, included: false },
      ],
    })
    expect(items.map((i) => i.kind)).toEqual([
      "user",
      "system",
      "system",
      "system",
      "thinking",
      "text",
      "tool",
      "thinking",
      "system",
    ])
    const tool = items.find((i) => i.kind === "tool") as Extract<
      (typeof items)[number],
      { kind: "tool" }
    >
    expect(tool).toMatchObject({
      name: "Cloud: web_search",
      result: { text: "Three results.", isError: false },
    })
    const notes = items.filter((i) => i.kind === "system").map((i) => (i as { text: string }).text)
    expect(notes).toEqual([
      "Attached notes.md: its text came with the export.",
      "Attached diagram.png: File content not included in the export.",
      "1 private word was taken out of this message.",
      "A image: File content not included in the export.",
    ])
    expect((items[7] as { text: string }).text).toMatch(/does not show \(hologram\)/)
  })

  it("saves the branch shown as Markdown", () => {
    expect(toMarkdown("Permission model", steps)).toBe(
      "# Permission model\n\n## You\n\nReview the flow.\n\n## Claude\n\nSecond answer.\n",
    )
  })
})

describe("the viewer", () => {
  it("says it is a read-only copy, moves between versions, and exports", async () => {
    api = vi.fn(async (method: string, url: string) => {
      if (url.startsWith("/api/chat/conversation?"))
        return {
          ok: true,
          status: 200,
          data: {
            conversation: {
              id: "c1",
              title: "Permission model",
              kind: "imported",
              provenance: { kind: "imported", exportDate: "2026-11-01T10:00:00Z" },
            },
            steps,
            attachments: {},
            artifacts: [
              {
                id: "x",
                title: "Plan",
                type: "text/markdown",
                versions: [{ createdAt: "", content: "# Plan" }],
              },
            ],
          },
        }
      if (method === "POST") return { ok: true, status: 200, data: { leaf: "a1" } }
      return { ok: false, status: 404 }
    })
    const { useStore } = await import("../src/store")
    const { ImportedChat } = await import("../src/surfaces/ImportedChat")
    act(() => useStore.getState().openImported("c1"))
    render(<ImportedChat />)
    expect(
      await screen.findByText(/^Imported from claude.ai on .*2026\. Read-only local copy\.$/),
    ).toBeTruthy()
    expect(screen.getByText("Second answer.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull()
    expect(screen.getByRole("group", { name: "Version 2 of 2" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show the version before" }))
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("POST", "/api/chat/conversation/switch", {
        id: "c1",
        messageId: "a1",
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Export as Markdown" }))
    expect(saved[0]).toMatchObject({ name: "Permission model.md", type: "text/markdown" })
    expect(screen.getByText("Plan (1 version)")).toBeTruthy()
  })
})
