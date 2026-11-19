// @vitest-environment jsdom
// T-113: the browser panel's tabs, and the ports the session's processes listen on, each a page to open.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BrowserBar, withTab } from "../src/components/BrowserBar"

vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: true, status: 200, data: { ports: [{ port: 5173, pid: 103, process: "node.exe", address: "::1" }] } })) }))
afterEach(cleanup)

describe("the browser panel (T-113)", () => {
  it("adds a tab for a page not open yet, chooses one that is, and keeps eight at most", () => {
    expect(withTab(["http://localhost:5173/"], "http://localhost:3000/")).toEqual(["http://localhost:5173/", "http://localhost:3000/"])
    expect(withTab(["http://localhost:5173/"], "http://localhost:5173/")).toEqual(["http://localhost:5173/"])
    expect(withTab(Array.from({ length: 8 }, (_, i) => `http://localhost:${3000 + i}/`), "http://localhost:9000/")).toHaveLength(8)
  })

  it("opens a port the session listens on as a page", async () => {
    const onOpen = vi.fn()
    render(<BrowserBar sessionId="s1" url="http://localhost:3000/" onOpen={onOpen} />)
    fireEvent.click(await screen.findByRole("button", { name: "5173 node" }))
    expect(onOpen).toHaveBeenCalledWith("http://localhost:5173/")
    expect(screen.getByRole("tab", { name: "localhost:3000" }).getAttribute("aria-selected")).toBe("true")
  })
})
