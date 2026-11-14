// @vitest-environment jsdom
// T-043 (t3code review): a stash of drafts. Stash this draft puts what you are writing aside with its files and clears
// the box; Stashed drafts brings one back (out of the stash) or deletes it; the stash is read tolerantly, newest 20.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PlusMenu } from "../src/components/PlusMenu"
import { dropStashed, stashDraft, stashed, stashLabel, takeStashed } from "../src/lib/stash"

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }), Toaster: () => null }))
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })) }))

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe("the draft stash (T-043)", () => {
  it("keeps drafts with their files, newest first, the newest 20, and reads a damaged stash as empty", () => {
    expect(stashDraft("   ", [])).toBeUndefined()
    const a = stashDraft("Fix the totals\nand the VAT", ["src/total.ts"], "shop", new Date("2026-11-14T10:00:00Z"))!
    stashDraft("", ["notes.md"])
    expect(stashed().map(stashLabel)).toEqual(["1 file", "Fix the totals"])
    expect(takeStashed(a.id)).toMatchObject({ text: "Fix the totals\nand the VAT", files: ["src/total.ts"], project: "shop" })
    expect(stashed()).toHaveLength(1)
    dropStashed(stashed()[0]!.id)
    expect(stashed()).toEqual([])
    for (let i = 0; i < 25; i++) stashDraft(`d${i}`, [])
    expect(stashed()).toHaveLength(20)
    expect(stashed()[0]!.text).toBe("d24")
    localStorage.setItem("gatehouse.stash", "{not json")
    expect(stashed()).toEqual([])
    localStorage.setItem("gatehouse.stash", JSON.stringify([{ id: "x", text: "kept", files: [3, "a.ts"], extra: true }, { nope: 1 }]))
    expect(stashed()).toEqual([{ id: "x", text: "kept", at: "", files: ["a.ts"], extra: true }])
  })

  it("stashes from the + menu, and brings a draft back or deletes it there", () => {
    stashDraft("Older draft", ["a.ts"], "shop")
    const onStash = vi.fn(() => true)
    const onRestore = vi.fn()
    render(<PlusMenu sessionId="s1" meta={undefined} onInsert={() => undefined} onStash={onStash} onRestore={onRestore} />)
    const open = () => fireEvent.click(screen.getByRole("button", { name: /Add files, a folder/ }))
    open()
    fireEvent.click(screen.getByRole("menuitem", { name: /Stash this draft/ }))
    expect(onStash).toHaveBeenCalledTimes(1)
    open()
    fireEvent.click(screen.getByRole("menuitem", { name: /Stashed drafts/ }))
    fireEvent.click(screen.getByRole("menuitem", { name: /Older draft/ }))
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ text: "Older draft", files: ["a.ts"] }))
    // Brought back means taken out of the stash.
    expect(stashed()).toEqual([])
    stashDraft("To delete", [])
    open()
    fireEvent.click(screen.getByRole("menuitem", { name: /Stashed drafts/ }))
    fireEvent.click(screen.getByRole("button", { name: "Delete the stashed draft To delete" }))
    expect(stashed()).toEqual([])
    expect(screen.getByText(/Nothing stashed/)).toBeTruthy()
  })
})
