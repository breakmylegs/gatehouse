// T-029: several runs of one prompt, each on its own model, started in the foreground or in the background.
import { describe, expect, it } from "vitest"
import { runModels, runsStarted } from "../src/lib/runs"

describe("several runs on several models (T-029)", () => {
  it("gives each run the model chosen for it, else the form's", () => {
    expect(runModels(3, ["opus", "", "sonnet"], "haiku")).toEqual(["opus", "haiku", "sonnet"])
    expect(runModels(2, [], "")).toEqual(["", ""])
    expect(runModels(2, ["a", "b", "c"], "x")).toEqual(["a", "b"])
  })

  it("says where they went and on which models", () => {
    const label = (id: string) => ({ opus: "Opus", sonnet: "Sonnet" })[id] ?? id
    expect(runsStarted(["opus", "sonnet", "opus"], false, label)).toBe("3 runs started on Opus and Sonnet, each in its own worktree. Keep the best when they are done.")
    expect(runsStarted(["opus", "opus"], true, label)).toBe("2 runs started in the background on Opus, each in its own worktree. They are in the sidebar; start something else here.")
    expect(runsStarted(["", ""], false, label)).toBe("2 runs started, each in its own worktree. Keep the best when they are done.")
  })
})
