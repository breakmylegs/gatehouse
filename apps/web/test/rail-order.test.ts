// T-023: your own order in the sidebar. Placed sessions come first in each section, as placed; a drop moves a session
// before a row or to a section's end; the keyboard moves one place; and a drop on another section pins it, moves it
// to a project or takes it out, or says why it cannot go there.
import { describe, expect, it } from "vitest"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { applyOrder, dropChange, moveBefore, moveBy } from "../src/lib/rail-order"

const s = (id: string, over: Partial<SessionInfo> = {}) => ({ id, cwd: "C:\\dev\\shop", title: id, createdAt: "2026-11-19T00:00:00Z", ...over }) as SessionInfo
const group = (folder: string, ...sessions: SessionInfo[]) => ({ folder, label: folder, sessions })

describe("the sidebar's own order (T-023)", () => {
  it("puts the sessions you placed first in each section, as placed, and the rest as they were", () => {
    const groups = [group("pinned:", s("a"), s("b"), s("c")), group("c:/dev", s("d"), s("e"))]
    expect(applyOrder(groups, ["c", "e", "a"]).map((g) => g.sessions.map((x) => x.id))).toEqual([
      ["c", "a", "b"],
      ["e", "d"],
    ])
    expect(applyOrder(groups, [])).toBe(groups)
  })

  it("moves a session before a row, to a section's end, or one place with the keyboard", () => {
    const shown = ["a", "b", "c", "d", "e"]
    expect(moveBefore(shown, "d", "b")).toEqual(["a", "d", "b", "c", "e"])
    expect(moveBefore(shown, "a", undefined, ["c", "d"])).toEqual(["b", "c", "d", "a", "e"])
    expect(moveBy(shown, ["b", "c", "d"], "c", -1)).toEqual(["a", "c", "b", "d", "e"])
    expect(moveBy(shown, ["b", "c", "d"], "c", 1)).toEqual(["a", "b", "d", "c", "e"])
    expect(moveBy(shown, ["b", "c", "d"], "b", -1)).toEqual(shown)
  })

  it("pins, moves to a project, or takes out of them by the section it is dropped on, and refuses one it cannot join", () => {
    expect(dropChange(s("a"), group("pinned:"))).toEqual({ pinned: true })
    expect(dropChange(s("a", { pinned: true }), group("pinned:"))).toBe("same")
    expect(dropChange(s("a", { pinned: true }), group("project:Launch"))).toEqual({ pinned: false, group: "Launch" })
    expect(dropChange(s("a", { group: "Launch" }), group("project:launch"))).toBe("same")
    // Its own folder takes it out of Pinned and the project; another folder or Working cannot have it.
    expect(dropChange(s("a", { pinned: true, group: "Launch" }), group("c:/dev"))).toEqual({ pinned: false, group: null })
    expect(dropChange(s("a"), group("c:/dev"))).toBe("same")
    expect(dropChange(s("a"), group("d:/work"))).toMatchObject({ refused: expect.stringMatching(/stays under its own folder/) })
    expect(dropChange(s("a"), group("working:"))).toMatchObject({ refused: expect.stringMatching(/running by themselves/) })
    // A chat goes back to the chats from a project you moved it to, but stays in the chat project it was started in.
    expect(dropChange(s("c", { kind: "chat", group: "Launch" }), group("chats:today"))).toEqual({ group: null })
    expect(dropChange(s("c", { kind: "chat", chatProject: "Research" }), group("chats:today"))).toMatchObject({ refused: expect.stringMatching(/Research/) })
  })
})
