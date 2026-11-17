// @vitest-environment jsdom
// O42: the Timeline on a session's bar: hidden until opened, it shows each ten-minute summary as a node with its date
// and time, the newest chosen, and a click shows the summary of the ten minutes before that node.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

let reply: unknown = { ok: true, status: 200, data: { nodes: [], enabled: true } }
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => reply) }))
const { SummaryTimeline } = await import("../src/components/SummaryTimeline")

afterEach(cleanup)

const node = (at: string, summary: string) => ({
  at,
  from: new Date(Date.parse(at) - 600_000).toISOString(),
  summary,
  activity: { you: 1, claude: 2, tools: 3 },
})

describe("a session's Timeline (O42)", () => {
  it("shows a node for each summary, the newest first chosen, and the summary of the one you press", async () => {
    reply = {
      ok: true,
      status: 200,
      data: { enabled: true, nodes: [node("2026-11-16T10:10:00Z", "Added the export."), node("2026-11-16T10:20:00Z", "Wrote its tests.")] },
    }
    render(<SummaryTimeline sessionId="s1" onClose={() => undefined} />)
    expect(await screen.findByText("Wrote its tests.")).toBeTruthy()
    const nodes = screen.getAllByRole("button", { name: /the ten minutes before/ })
    expect(nodes).toHaveLength(2)
    expect(nodes[1]!.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(nodes[0]!)
    expect(screen.getByText("Added the export.")).toBeTruthy()
    expect(screen.queryByText("Wrote its tests.")).toBeNull()
    expect(screen.getByText(/3 tool calls/)).toBeTruthy()
  })

  it("says when there is nothing yet, and when summaries are off", async () => {
    reply = { ok: true, status: 200, data: { enabled: true, nodes: [] } }
    const { unmount } = render(<SummaryTimeline sessionId="s1" onClose={() => undefined} />)
    expect(await screen.findByText(/Nothing yet/)).toBeTruthy()
    unmount()
    reply = { ok: true, status: 200, data: { enabled: false, nodes: [] } }
    render(<SummaryTimeline sessionId="s1" onClose={() => undefined} />)
    expect(await screen.findByText(/Summaries are off/)).toBeTruthy()
  })
})
