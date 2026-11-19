// @vitest-environment jsdom
// T-075: the Pull requests page reads a description's task boxes and says what happened to each change in words.
import { describe, expect, it } from "vitest"
import { actText, tasksOf } from "../src/components/PullRequests"

describe("the Pull requests page (T-075)", () => {
  it("finds the description's task boxes, ticked or not", () => {
    expect(tasksOf("Intro\n- [ ] tests pass\n  - [x] docs\n* [X] notes\nnot - [ ] this")).toEqual([
      { text: "tests pass", done: false },
      { text: "docs", done: true },
      { text: "notes", done: true },
    ])
  })

  it("says whether a change happened, was refused, or failed", () => {
    expect(actText({ ran: true, exitCode: 0, output: "" }, "Merging")).toBe("Merging: done.")
    expect(actText({ ran: false, refused: "you said no on the approval card", exitCode: null, output: "" }, "Merging")).toBe("Merging did not happen: you said no on the approval card.")
    expect(actText({ ran: true, exitCode: 1, output: "x\nPull request is not mergeable\n" }, "Merging")).toBe("Merging failed (exit 1): Pull request is not mergeable")
  })
})

describe("stacks in words (T-081)", () => {
  it("says it all went through, or how far it got and why it stopped", async () => {
    const { stackText } = await import("../src/components/PullRequests")
    expect(stackText({ stack: [10, 11], steps: [{ number: 10, ran: true, exitCode: 0 }, { number: 11, ran: true, exitCode: 0 }], done: true }, "Merging the stack")).toBe("Merging the stack: all 2 done, bottom up.")
    expect(stackText({ stack: [10, 11, 12], steps: [{ number: 10, ran: true, exitCode: 0 }, { number: 11, ran: false, exitCode: null, refused: "you said no" }], done: false }, "Merging the stack")).toBe("Merging the stack stopped: #10 done, then #11 did not happen: you said no.")
  })
})
