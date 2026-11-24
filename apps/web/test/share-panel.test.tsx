// @vitest-environment jsdom
// G40: Share and publish in a session: what the zip leaves out is named before it is made, the zip is downloaded,
// a named host publishes with its own tool and its output is shown; Settings keeps each host as name | command.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
const downloads: Array<[string, string]> = []
let publishers = ["Netlify"]
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url.startsWith("/api/share/plan")) return { ok: true, status: 200, data: { project: "shop", files: 12, bytes: 2_500_000, left: [{ file: ".env", why: "an environment file" }, { file: "src/keys.ts", why: "it holds an AWS access key (line 2)" }], publishers } }
    return { ok: true, status: 200, data: { exitCode: 0, timedOut: false, output: "Deployed: https://shop.example" } }
  }),
  download: vi.fn(async (url: string, name: string) => {
    downloads.push([url, name])
    return undefined
  }),
}))
const { SharePanel } = await import("../src/components/SharePanel")
const { parsePubLines, pubLine } = await import("../src/surfaces/Settings")
afterEach(() => {
  cleanup()
  calls.length = 0
  downloads.length = 0
  publishers = ["Netlify"]
})

describe("Share and publish (G40)", () => {
  it("names what the zip leaves out before it is made, downloads it, and publishes with a named host", async () => {
    render(<SharePanel sessionId="s1" onClose={() => undefined} />)
    expect(await screen.findByText(/A zip of shop: 12 files, 2.4 MB/)).toBeTruthy()
    const left = screen.getByRole("list", { name: "Left out" })
    expect(within(left).getByText(".env")).toBeTruthy()
    expect(within(left).getByText("(it holds an AWS access key (line 2))")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Download the zip" }))
    await waitFor(() => expect(downloads).toEqual([["/api/share/zip?session=s1", "shop.zip"]]))
    fireEvent.click(screen.getByRole("button", { name: "Publish with Netlify" }))
    expect((await screen.findByRole("status")).textContent).toMatch(/Netlify finished\.[\s\S]*Deployed: https:\/\/shop\.example/)
    expect(calls.at(-1)).toEqual({ method: "POST", url: "/api/share/publish", body: { session: "s1", name: "Netlify" } })
  })

  it("says to name a host when none is named", async () => {
    publishers = []
    render(<SharePanel sessionId="s1" onClose={() => undefined} />)
    expect(await screen.findByText(/No host is named/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Publish with/ })).toBeNull()
  })

  it("keeps each host as name | command, quoted words too, and leaves out a line without both", () => {
    expect(parsePubLines('Netlify | netlify deploy --dir "my site" --prod\nbroken\nEmpty |')).toEqual([{ name: "Netlify", command: "netlify", args: ["deploy", "--dir", "my site", "--prod"] }])
    const p = { name: "Vercel", command: "C:\\Tools\\vercel tool.exe", args: ["deploy"] }
    expect(parsePubLines(pubLine(p))).toEqual([p])
  })
})
