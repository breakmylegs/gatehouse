// @vitest-environment jsdom
// O40 (owner, 15 Nov): a prompt an Ask about code chat sent a coding session, once approved, shows in that session's
// transcript, with a line saying which chat sent it.
import { describe, expect, it } from "vitest"
import { useStore } from "../src/store"

describe("a handed prompt in the coding session (O40)", () => {
  it("shows where it came from and the prompt itself", () => {
    useStore.setState({
      sessions: { s1: { id: "s1", cwd: "C:/k", project: "keepsake", mode: "default", state: "idle", pendingApprovals: 0, createdAt: "2026-11-15T08:00:00Z" } },
      transcripts: {},
    } as never)
    useStore.getState().handleEvent({
      type: "session_event",
      sessionId: "s1",
      event: "handed_prompt",
      data: { from: "Release zip names", text: "Also upload the zip under a fixed name." },
    } as never)
    const items = useStore.getState().transcripts.s1!.items
    expect(items.map((i) => i.kind)).toEqual(["system", "user"])
    expect((items[0] as { text: string }).text).toBe('The Ask about code chat "Release zip names" sent this prompt, which you approved:')
    expect((items[1] as { text: string }).text).toBe("Also upload the zip under a fixed name.")
  })
})
