// @vitest-environment jsdom
// T-110: right-to-left text. The message box and each paragraph of a reply find their own direction, so Arabic or
// Hebrew reads right to left beside English; code stays left to right.
import fs from "node:fs"
import path from "node:path"
import { cleanup, render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }), Toaster: () => null }))
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })) }))
vi.mock("react-virtuoso", () => ({ Virtuoso: forwardRef(function V() { return <div /> }) }))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never
afterEach(cleanup)

describe("right-to-left text (T-110)", () => {
  it("lets the message box find its direction from what you type", () => {
    useStore.setState({
      sessions: { s1: { id: "s1", cwd: "C:/dev/shop", project: "shop", mode: "default", state: "idle", pendingApprovals: 0, createdAt: "2026-11-19T00:00:00Z" } as never },
      transcripts: {},
      pending: {},
      panes: [],
      selectedSession: "s1",
      route: "workspace",
    })
    render(<Workspace />)
    expect(screen.getByRole("textbox", { name: "Prompt" }).getAttribute("dir")).toBe("auto")
  })

  it("gives each paragraph of a reply its own direction and keeps code left to right", () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, "../src/styles.css"), "utf8")
    expect(css).toMatch(/\.reply :where\(p, li, h1, h2, h3, h4, blockquote, td, th\),[\s\S]*?unicode-bidi: plaintext;/)
    expect(css).toMatch(/\.reply :where\(pre, code\) \{\s*direction: ltr;/)
  })
})
