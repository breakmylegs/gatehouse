// @vitest-environment jsdom
// CH-03 (owner's Chat build, 4 Nov): a chat shows exactly what Claude was told it remembers when it started.
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryGiven, useMemoryGiven } from "../src/components/MemoryGiven"

const api = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  status: 200,
  data: {
    entries: [
      { id: "m1", scope: "global", topic: "Units", text: "Prefers metric." },
      { id: "m2", scope: "Centrica", topic: "Tone", text: "Plain, short answers." },
    ],
  },
}))
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("what a chat was told it remembers", () => {
  it("is asked for only when the panel opens", async () => {
    renderHook(() => useMemoryGiven("s1", false))
    expect(api).not.toHaveBeenCalled()
    const open = renderHook(() => useMemoryGiven("s1", true))
    await waitFor(() => expect(open.result.current).toHaveLength(2))
    expect(api).toHaveBeenCalledWith("GET", "/api/memory/given?session=s1")
  })

  it("shows each entry in the words it was given, and where it came from", () => {
    render(
      <MemoryGiven
        entries={[
          { id: "m1", scope: "global", topic: "Units", text: "Prefers metric." },
          { id: "m2", scope: "Centrica", topic: "Tone", text: "Plain, short answers." },
        ]}
      />,
    )
    expect(screen.getByText("Prefers metric.")).toBeTruthy()
    expect(screen.getByText("Units · every chat")).toBeTruthy()
    expect(screen.getByText("Tone · Centrica")).toBeTruthy()
  })

  it("says so when it was told nothing", () => {
    render(<MemoryGiven entries={[]} />)
    expect(screen.getByText(/Claude was told nothing from memory/)).toBeTruthy()
  })
})
