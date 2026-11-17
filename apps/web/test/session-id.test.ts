// @vitest-environment jsdom
// T-031: Copy session id, in a session's menu, copies the id Claude Code knows it by (claude --resume <id>).
import { describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }) }))
const { copySessionId } = await import("../src/lib/sessionActions")

describe("copying a session's id (T-031)", () => {
  it("puts the id on the clipboard", async () => {
    const copied: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async (t: string) => void copied.push(t)), write: vi.fn(async () => undefined) },
    })
    await copySessionId("8f2e5c3a-1b2c-4d5e-9f00-112233445566")
    expect(copied).toEqual(["8f2e5c3a-1b2c-4d5e-9f00-112233445566"])
  })
})
