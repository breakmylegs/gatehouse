// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PushPanel } from "../src/components/PushPanel"

const posted: Array<{ url: string; body: unknown }> = []

vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    if (method === "POST") posted.push({ url, body })
    if ((body as { topic?: string } | undefined)?.topic === "my-alerts")
      return { ok: false, status: 400, error: "That is not a topic JCVC made." }
    if (url === "/api/push")
      return {
        ok: true,
        status: 200,
        data: {
          ntfy: {
            enabled: true,
            listening: true,
            sent: 0,
            server: "https://ntfy.sh",
            topic: "jcvc-abcd-efgh-jkmn-pqrs-tuvw",
            maxRisk: 69,
          },
        },
      }
    return { ok: true, status: 200, data: { enabled: true, listening: true, sent: 0 } }
  }),
}))

beforeEach(() => {
  posted.length = 0
})
afterEach(cleanup)

describe("the ntfy topic your phone is subscribed to", () => {
  it("asks before making new topics, because the phone stops getting requests", async () => {
    render(<PushPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "Make new topics" }))
    expect(screen.getByText(/stop reaching your phone/)).toBeTruthy()
    expect(posted).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Keep this topic" }))
    expect(posted).toEqual([])
    expect(screen.queryByText(/stop reaching your phone/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Make new topics" }))
    fireEvent.click(screen.getByRole("button", { name: "Replace the topic" }))
    await waitFor(() =>
      expect(posted).toEqual([
        { url: "/api/push/ntfy/enable", body: expect.objectContaining({ newTopics: true }) },
      ]),
    )
  })

  it("takes the topic the phone already has, so you need not subscribe again", async () => {
    render(<PushPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "My phone has a different topic" }))
    fireEvent.change(screen.getByRole("textbox", { name: /^Topic on your phone/ }), {
      target: { value: "jcvc-t6YdOCy5dH5TBqoPnEXrLC" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Use this topic" }))
    await waitFor(() =>
      expect(posted).toEqual([
        {
          url: "/api/push/ntfy/enable",
          body: expect.objectContaining({ topic: "jcvc-t6YdOCy5dH5TBqoPnEXrLC", newTopics: false }),
        },
      ]),
    )
  })

  it("says why a topic was refused next to the box, and Cancel clears it", async () => {
    render(<PushPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "My phone has a different topic" }))
    const box = screen.getByRole("textbox", { name: /^Topic on your phone/ })
    fireEvent.change(box, { target: { value: "my-alerts" } })
    fireEvent.click(screen.getByRole("button", { name: "Use this topic" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("That is not a topic JCVC made.")
    expect(box.parentElement?.parentElement?.contains(alert)).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
