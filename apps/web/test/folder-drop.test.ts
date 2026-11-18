// T-005: a folder dropped on the sidebar goes to the Codehouse window with the dropped items, which reads the folder's
// real path; in a browser or CNW there is no window to do that, and the page says how to open a folder instead.
import { afterEach, describe, expect, it, vi } from "vitest"
import { dropToShell } from "../src/lib/shell"

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

describe("dropping a folder on the sidebar", () => {
  it("hands the dropped items to the window as folder-drop, and says when there is no window to read them", () => {
    const files = [new File([], "my-project")]
    expect(dropToShell(files)).toBe("no-shell")
    const post = vi.fn()
    ;(globalThis as { chrome?: unknown }).chrome = { webview: { postMessage: vi.fn(), postMessageWithAdditionalObjects: post } }
    expect(dropToShell(files)).toBe("sent")
    expect(post).toHaveBeenCalledWith("folder-drop", files)
    expect(dropToShell([])).toBe("no-shell")
    // A window too old for it.
    ;(globalThis as { chrome?: unknown }).chrome = { webview: { postMessage: vi.fn() } }
    expect(dropToShell(files)).toBe("no-shell")
  })
})
