// @vitest-environment jsdom
// Backlog U8: layout presets, from the session you are on and the other open ones, newest first.
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { describe, expect, it } from "vitest"
import { applyLayout, panesFor, RAIL_EVENT } from "../src/lib/layouts"
import { useStore } from "../src/store"

const s = (id: string, createdAt: string, state: SessionInfo["state"] = "idle") =>
  ({
    id,
    cwd: "C:/x",
    project: id,
    mode: "default",
    state,
    pendingApprovals: 0,
    createdAt,
  }) as SessionInfo

const list = [
  s("a", "2026-11-08T09:00:00Z"),
  s("b", "2026-11-08T10:00:00Z"),
  s("c", "2026-11-08T11:00:00Z"),
  s("d", "2026-11-08T12:00:00Z"),
  s("e", "2026-11-08T13:00:00Z"),
  s("gone", "2026-11-08T14:00:00Z", "ended"),
]

describe("layout presets", () => {
  it("put the session you are on first, then the newest open ones, never an ended one", () => {
    expect(panesFor("one", list, "b")).toEqual(["b"])
    expect(panesFor("focus", list, "b")).toEqual(["b"])
    expect(panesFor("two", list, "b")).toEqual(["b", "e"])
    expect(panesFor("four", list, "b")).toEqual(["b", "e", "d", "c"])
    // No session chosen, or an ended one: the newest open one leads.
    expect(panesFor("two", list, undefined)).toEqual(["e", "d"])
    expect(panesFor("two", list, "gone")).toEqual(["e", "d"])
    expect(panesFor("four", [], undefined)).toEqual([])
    expect(panesFor("four", list.slice(0, 2), "a")).toEqual(["a", "b"])
  })

  it("set the panes, open the workspace, and hide the sidebar only for focus", () => {
    useStore.setState({
      sessions: Object.fromEntries(list.map((x) => [x.id, x])),
      selectedSession: "c",
      panes: ["c"],
      route: "dashboard",
    })
    const told: boolean[] = []
    const listen = (e: Event) => told.push((e as CustomEvent<{ hidden: boolean }>).detail.hidden)
    window.addEventListener(RAIL_EVENT, listen)
    try {
      applyLayout("four")
      expect(useStore.getState()).toMatchObject({ panes: ["c", "e", "d", "b"], route: "workspace" })
      applyLayout("focus")
      expect(useStore.getState().panes).toEqual(["c"])
    } finally {
      window.removeEventListener(RAIL_EVENT, listen)
    }
    expect(told).toEqual([false, true])
  })
})
