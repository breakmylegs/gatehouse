// @vitest-environment jsdom
// T-061 (t3code review): the Git pane's Pull requests tab lists open pull requests and shows one's checks, as text;
// while the connection is off it says so.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

let off = false
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) => {
    if (off) return { ok: false, status: 403, error: "The GitHub connection is off. Switch it on in Settings, Connectors." }
    if (url.startsWith("/api/forge/prs"))
      return { ok: true, status: 200, data: { prs: [{ number: 12, title: "<img src=x onerror=alert(1)>", state: "OPEN", url: "https://github.com/a/b/pull/12", branch: "fix/x", draft: false }] } }
    return { ok: true, status: 200, data: { pr: { number: 12, title: "Fix", state: "OPEN", url: "https://github.com/a/b/pull/12", branch: "fix/x", draft: false, base: "main", checks: [{ name: "build", state: "FAILURE" }] } } }
  }),
}))
const { PullRequests } = await import("../src/components/PullRequests")

afterEach(cleanup)

describe("the Pull requests tab (T-061)", () => {
  it("lists them as text and shows one's checks", async () => {
    off = false
    const { container } = render(<PullRequests q="session=s1" />)
    fireEvent.click(await screen.findByRole("button", { name: /#12/ }))
    expect(container.querySelector("img")).toBeNull()
    expect(await screen.findByRole("list", { name: "Checks" })).toBeTruthy()
    expect(screen.getByText("failure")).toBeTruthy()
  })

  it("says the connection is off", async () => {
    off = true
    render(<PullRequests q="session=s1" />)
    expect((await screen.findByRole("alert")).textContent).toContain("Switch it on in Settings")
  })
})
