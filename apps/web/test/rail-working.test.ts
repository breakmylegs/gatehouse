// T-027: sessions working on their own are listed together under Working, after Pinned; one that waits on you, a pinned
// one and a chat stay where they were, and Ctrl+1 to 9 count them in the order the sidebar shows.
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { describe, expect, it } from "vitest"
import { groupByFolder, railOrder, WORKING } from "../src/lib/rail"

const s = (id: string, state: SessionInfo["state"], o: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, cwd: `C:/dev/${id}`, project: id, mode: "default", state, pendingApprovals: 0, createdAt: "2026-11-17T09:00:00Z", ...o }) as SessionInfo

describe("the Working section (T-027)", () => {
  it("gathers running sessions after Pinned, and leaves waiting, pinned and chat sessions where they were", () => {
    const list = [
      s("a", "running"),
      s("b", "waiting"),
      s("c", "running", { pinned: true }),
      s("d", "idle"),
      s("e", "running", { kind: "chat" } as Partial<SessionInfo>),
    ]
    const groups = groupByFolder(list, { ended: false, working: true })
    expect(groups.map((g) => g.label)).toEqual(["Pinned", "Working", "dev", "Chats"])
    expect(groups.find((g) => g.folder === WORKING)!.sessions.map((x) => x.id)).toEqual(["a"])
    expect(groups.find((g) => g.label === "dev")!.sessions.map((x) => x.id).sort()).toEqual(["b", "d"])
    // Without it, as before.
    expect(groupByFolder(list, { ended: false }).some((g) => g.folder === WORKING)).toBe(false)
    expect(railOrder(list, false).map((x) => x.id)).toEqual(groups.flatMap((g) => g.sessions.map((x) => x.id)))
  })
})
