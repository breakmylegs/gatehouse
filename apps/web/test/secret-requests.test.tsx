// @vitest-environment jsdom
// T-135: the desktop card for a secret a session asks for: what it is for, a hidden field, Give or Decline.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SecretRequests } from "../src/components/SecretRequests"

const posted: Array<[string, unknown]> = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    if (method === "GET") return { ok: true, status: 200, data: { requests: [{ id: "r1", sessionId: "s1", name: "NPM_TOKEN", reason: "to publish", command: "npm publish", at: "" }] } }
    posted.push([url, body])
    return { ok: true, status: 200, data: { ok: true } }
  }),
}))
afterEach(cleanup)

describe("the secret card (T-135)", () => {
  it("shows the command, hides what you type, and sends it only when you give it", async () => {
    render(<SecretRequests />)
    const card = await screen.findByRole("dialog", { name: "A session asks for NPM_TOKEN" })
    expect(card.textContent).toContain("npm publish")
    const field = screen.getByLabelText("The value of NPM_TOKEN") as HTMLInputElement
    expect(field.type).toBe("password")
    const give = screen.getByRole("button", { name: "Give it for this command" }) as HTMLButtonElement
    expect(give.disabled).toBe(true)
    fireEvent.change(field, { target: { value: "npm_abc123" } })
    fireEvent.click(give)
    await waitFor(() => expect(posted).toEqual([["/api/secret-requests/r1", { value: "npm_abc123" }]]))
  })
})
