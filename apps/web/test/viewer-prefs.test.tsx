// @vitest-environment jsdom
// Settings, Sessions, Viewer: what Claude writes opens in the viewer by itself, and links to local pages open there.
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  LOCAL_PAGE,
  readViewerPrefs,
  saveViewerPrefs,
  useOpenWhatClaudeWrites,
} from "../src/lib/viewerPrefs"
import type { Item } from "../src/lib/transcript"

afterEach(() => localStorage.clear())

const write = (id: string, file: string, done = true, isError = false) =>
  ({
    kind: "tool",
    toolUseId: id,
    name: "Write",
    input: { file_path: file },
    ...(done ? { result: { text: "ok", isError } } : {}),
  }) as unknown as Item

describe("the viewer", () => {
  it("opens a page or picture Claude writes from now on, never one from before, a failed one or other files", () => {
    const open = vi.fn()
    let items: Item[] = [write("a", "C:/p/old.html")]
    const { rerender } = renderHook(
      ({ list, on, key }: { list: Item[]; on: boolean; key: string }) =>
        useOpenWhatClaudeWrites(key, list, open, on),
      { initialProps: { list: items, on: true, key: "s1" } },
    )
    expect(open).not.toHaveBeenCalled()
    items = [...items, write("b", "C:/p/notes.txt"), write("c", "C:/p/chart.svg", true, true)]
    rerender({ list: items, on: true, key: "s1" })
    expect(open).not.toHaveBeenCalled()
    items = [...items, write("d", "C:/p/page.html", false)]
    rerender({ list: items, on: true, key: "s1" })
    expect(open).not.toHaveBeenCalled()
    items = items.map((i) =>
      (i as { toolUseId?: string }).toolUseId === "d" ? write("d", "C:/p/page.html") : i,
    )
    rerender({ list: items, on: true, key: "s1" })
    expect(open).toHaveBeenCalledWith("C:/p/page.html")
    rerender({ list: [...items], on: true, key: "s1" })
    expect(open).toHaveBeenCalledTimes(1)
    // Turned off: nothing opens.
    rerender({ list: [...items, write("e", "C:/p/shot.png")], on: false, key: "s1" })
    expect(open).toHaveBeenCalledTimes(1)
    // The pane shows another session: what it wrote before is history, not new.
    rerender({ list: [write("x", "C:/q/old.png")], on: true, key: "s2" })
    expect(open).toHaveBeenCalledTimes(1)
    rerender({
      list: [write("x", "C:/q/old.png"), write("y", "C:/q/new.png")],
      on: true,
      key: "s2",
    })
    expect(open).toHaveBeenLastCalledWith("C:/q/new.png")
  })

  it("is on unless turned off, keeps what a newer version saved, and opens only pages on this computer", () => {
    expect(readViewerPrefs()).toEqual({ autoOpen: true, localLinks: true })
    localStorage.setItem("gatehouse.viewer", JSON.stringify({ future: 1 }))
    saveViewerPrefs({ autoOpen: false, localLinks: true })
    expect(JSON.parse(localStorage.getItem("gatehouse.viewer")!)).toEqual({
      future: 1,
      autoOpen: false,
      localLinks: true,
    })
    expect(readViewerPrefs().autoOpen).toBe(false)
    expect(LOCAL_PAGE.test("http://localhost:5173/")).toBe(true)
    expect(LOCAL_PAGE.test("http://127.0.0.1:8080/x")).toBe(true)
    for (const bad of [
      "https://claude.ai/",
      "http://localhost.evil.com/",
      "http://127.0.0.1.nip.io/",
      "javascript:alert(1)",
    ])
      expect(LOCAL_PAGE.test(bad), bad).toBe(false)
  })
})
