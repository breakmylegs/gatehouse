// @vitest-environment jsdom
// Backlog G24: the task board. Space and the arrow keys move a card, each step is said, and nothing moves (so no
// session starts) until it is dropped.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let cards: Array<Record<string, unknown>> = []
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url === "/api/board") return { ok: true, status: 200, data: { cards } }
    if (url === "/api/board/move") {
      const b = body as { id: string; column: string }
      const card: Record<string, unknown> = {
        ...cards.find((c) => c.id === b.id)!,
        column: b.column,
      }
      if (b.column === "running") card.sessionId = "s9"
      cards = cards.map((c) => (c.id === b.id ? card : c))
      return { ok: true, status: 200, data: { card } }
    }
    return { ok: true, status: 200, data: {} }
  }),
}))
const { Board, columnCards } = await import("../src/surfaces/Board")

const card = (id: string, title: string, column = "todo") => ({
  id,
  title,
  prompt: "Do it.",
  folder: "C:\\dev\\shop",
  column,
  createdAt: "2026-11-09T09:00:00Z",
})

beforeEach(() => {
  calls.length = 0
  cards = [card("a", "Add a basket"), card("b", "Fix the logo"), card("c", "Write docs", "review")]
})
afterEach(cleanup)

const moves = () => calls.filter((c) => c.url === "/api/board/move")
const said = () => screen.getByRole("status").textContent

describe("the task board", () => {
  it("shows each column with its cards in order", async () => {
    render(<Board />)
    const todo = await screen.findByRole("region", { name: "To do" })
    await waitFor(() => expect(within(todo).getAllByRole("listitem")).toHaveLength(2))
    expect(
      within(screen.getByRole("region", { name: "Review" })).getByText("Write docs"),
    ).toBeTruthy()
  })

  it("moves a card with Space and the arrow keys, saying each step, and starts its session only once dropped in Running", async () => {
    render(<Board />)
    await screen.findByRole("button", { name: "Add a basket, in To do" })
    // The card is drawn anew in each column it passes; focus follows it, and the keys go where focus is.
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key })
    screen.getByRole("button", { name: "Add a basket, in To do" }).focus()
    press(" ")
    expect(said()).toMatch(/Picked up Add a basket, in To do/)
    press("ArrowRight")
    expect(said()).toBe("Add a basket: Running, place 1 of 1.")
    press("ArrowRight")
    expect(said()).toBe("Add a basket: Review, place 2 of 2.")
    expect(document.activeElement?.textContent).toBe("Add a basket")
    // Passing through Running started nothing.
    expect(moves()).toEqual([])
    press("ArrowLeft")
    press(" ")
    await waitFor(() => expect(moves()).toHaveLength(1))
    expect(moves()[0]!.body).toEqual({ id: "a", column: "running", index: 0 })
    await waitFor(() =>
      expect(said()).toBe("Add a basket moved to Running, and its session started."),
    )
  })

  it("puts a picked-up card back with Escape, moving nothing", async () => {
    render(<Board />)
    const b = await screen.findByRole("button", { name: "Fix the logo, in To do" })
    fireEvent.keyDown(b, { key: " " })
    fireEvent.keyDown(b, { key: "ArrowUp" })
    expect(said()).toBe("Fix the logo: To do, place 1 of 2.")
    fireEvent.keyDown(b, { key: "Escape" })
    expect(said()).toBe("Fix the logo put back in To do.")
    expect(moves()).toEqual([])
  })

  it("shows a picked-up card where it would go", () => {
    const list = [card("a", "A"), card("b", "B"), card("c", "C", "review")] as never
    expect(
      columnCards(list, "review", { id: "a", column: "review", index: 0 }).map((c) => c.id),
    ).toEqual(["a", "c"])
    expect(
      columnCards(list, "todo", { id: "a", column: "review", index: 0 }).map((c) => c.id),
    ).toEqual(["b"])
  })
})
