// @vitest-environment jsdom
// T-101: a message on the phone is kept as a draft for its session while offline, and nothing is signed until it is
// sent online.
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { readDraft, saveDraft, useOnline } from "../src/drafts"

beforeEach(() => localStorage.clear())

describe("drafts on the phone (T-101)", () => {
  it("keeps a draft for each session, and forgets one emptied or sent", () => {
    saveDraft("s1", "Please also update the docs")
    saveDraft("s2", "Stop after the tests")
    expect(readDraft("s1")).toBe("Please also update the docs")
    expect(readDraft("s2")).toBe("Stop after the tests")
    saveDraft("s1", "   ")
    expect(readDraft("s1")).toBe("")
    saveDraft("s2", "")
    expect(localStorage.getItem("codehouse.phone.drafts")).toBeNull()
    expect(readDraft("nope")).toBe("")
  })

  it("follows the connection going and coming back", () => {
    const { result } = renderHook(() => useOnline())
    expect(result.current).toBe(true)
    act(() => void window.dispatchEvent(new Event("offline")))
    expect(result.current).toBe(false)
    act(() => void window.dispatchEvent(new Event("online")))
    expect(result.current).toBe(true)
  })
})
