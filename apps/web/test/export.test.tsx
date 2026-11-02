// @vitest-environment jsdom
// W1-13: export with a preview. The Host masks the redaction list, the preview is exactly what is saved, and only a
// save is recorded.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExportDialog, htmlPage, openExport } from "../src/components/ExportDialog"

const calls: Array<Record<string, unknown>> = []
const saved: Array<{ name: string; text: string; type: string }> = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: { type: string; all?: boolean }) =>
      cmd.type === "history_messages"
        ? {
            ok: true,
            data: [
              { type: "user", message: { content: "Plan the Project Falcon launch" } },
              {
                type: "assistant",
                message: { content: [{ type: "text", text: "Here is the plan." }] },
              },
            ],
          }
        : { ok: true },
    ),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string, body: Record<string, unknown>) => {
    if (url !== "/api/export/redact") return { ok: false, status: 404, error: "no route" }
    calls.push(body)
    const text = String(body.text).replaceAll("Project Falcon", "[REDACTED:term]")
    return { ok: true, status: 200, data: { text, masked: 1 } }
  }),
}))
vi.mock("../src/lib/exportMarkdown", async (orig) => {
  const actual = await orig<typeof import("../src/lib/exportMarkdown")>()
  return {
    ...actual,
    download: (name: string, text: string, type: string) => void saved.push({ name, text, type }),
  }
})

beforeEach(() => {
  calls.length = 0
  saved.length = 0
})
afterEach(cleanup)

describe("exporting with a preview", () => {
  it("shows the masked conversation, and saves exactly that, recording only the save", async () => {
    render(<ExportDialog />)
    act(() => openExport({ title: "Launch", sdkSessionId: "sdk-1" }))
    const preview = await screen.findByLabelText("What will be saved")
    await waitFor(() => expect(preview.textContent).toContain("[REDACTED:term]"))
    expect(preview.textContent).not.toMatch(/falcon/i)
    expect(screen.getByRole("status").textContent).toMatch(/1 thing was masked/)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ preview: true })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(calls[1]).toMatchObject({ format: "md" })
    expect(calls[1]).not.toHaveProperty("preview")
    expect(saved[0]!.text).toContain("[REDACTED:term]")
    expect(saved[0]!.text).not.toMatch(/falcon/i)
    expect(saved[0]!.name).toMatch(/\.md$/)
  })

  it("saves a web page from the masked text, and keeps code blocks", async () => {
    render(<ExportDialog />)
    act(() => openExport({ title: "Launch", sdkSessionId: "sdk-1" }))
    await screen.findByText(/thing was masked/)
    fireEvent.click(screen.getByRole("radio", { name: "Web page (.html)" }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]!.type).toBe("text/html")
    expect(saved[0]!.name).toMatch(/\.html$/)
    expect(saved[0]!.text).not.toMatch(/falcon/i)
    expect(htmlPage("T", "```\nnpm test\n```")).toContain("<pre><code>npm test")
  })
})
