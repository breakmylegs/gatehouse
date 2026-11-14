// T-041 (t3code review): Up in an empty prompt box brings back earlier prompts, Down goes forward and back to what you
// were writing; only from an empty box or a prompt brought back; kept per session, never /commands.
import { afterEach, describe, expect, it } from "vitest"
import { forgetSent, recallStep, rememberSent, sentPrompts } from "../src/lib/promptRecall"

afterEach(forgetSent)

describe("recalling sent prompts (T-041)", () => {
  it("brings back earlier prompts with Up and goes forward with Down, back to the empty box", () => {
    rememberSent("s1", "first")
    rememberSent("s1", "second")
    let r = recallStep("s1", "ArrowUp", "", true, undefined)
    expect(r).toEqual({ text: "second", recall: { index: 1, draft: "" } })
    r = recallStep("s1", "ArrowUp", r!.text, true, r!.recall)
    expect(r?.text).toBe("first")
    // At the oldest, Up stays there.
    expect(recallStep("s1", "ArrowUp", "first", true, r!.recall)?.text).toBe("first")
    r = recallStep("s1", "ArrowDown", "first", true, r!.recall)
    expect(r?.text).toBe("second")
    r = recallStep("s1", "ArrowDown", "second", true, r!.recall)
    expect(r).toEqual({ text: "", recall: undefined })
  })

  it("leaves Up alone while you write, and with the caret inside a brought-back prompt", () => {
    rememberSent("s1", "first")
    expect(recallStep("s1", "ArrowUp", "half written", true, undefined)).toBeUndefined()
    expect(recallStep("s1", "ArrowDown", "", true, undefined)).toBeUndefined()
    const r = recallStep("s1", "ArrowUp", "", true, undefined)
    expect(recallStep("s1", "ArrowUp", "first", false, r!.recall)).toBeUndefined()
  })

  it("keeps each session's own prompts, not commands, not the same one twice in a row, the newest 50", () => {
    rememberSent("s1", "/plan")
    rememberSent("s1", "fix it")
    rememberSent("s1", "fix it")
    rememberSent("s2", "other")
    expect(sentPrompts("s1")).toEqual(["fix it"])
    expect(recallStep("s3", "ArrowUp", "", true, undefined)).toBeUndefined()
    for (let i = 0; i < 60; i++) rememberSent("s4", `p${i}`)
    expect(sentPrompts("s4")).toHaveLength(50)
    expect(sentPrompts("s4")[0]).toBe("p10")
  })
})
