// @vitest-environment jsdom
// T-017: a new session starts with the model, effort and mode you chose last, and a folder you started in before with
// what you chose there. An Extreme approval mode is never remembered: it is chosen each time.
import { beforeEach, describe, expect, it } from "vitest"
import { choicesFor, folderKey, hasFolderChoices, rememberChoices } from "../src/lib/newSessionChoices"

beforeEach(() => localStorage.clear())

describe("choices for a new session (T-017)", () => {
  it("starts with nothing remembered, then with your last choices, and a folder with its own", () => {
    expect(choicesFor()).toEqual({})
    rememberChoices("C:\\dev\\shop", { model: "claude-opus-5-5", effort: "high", mode: "acceptEdits" })
    rememberChoices("C:\\dev\\blog", { model: "claude-sonnet-5-5", effort: "", mode: "plan" })
    expect(choicesFor()).toEqual({ model: "claude-sonnet-5-5", effort: "", mode: "plan" })
    expect(choicesFor("c:/dev/Shop/")).toEqual({ model: "claude-opus-5-5", effort: "high", mode: "acceptEdits" })
    expect(hasFolderChoices("C:\\dev\\shop")).toBe(true)
    expect(hasFolderChoices("C:\\dev\\new")).toBe(false)
    expect(choicesFor("C:\\dev\\new")).toEqual({ model: "claude-sonnet-5-5", effort: "", mode: "plan" })
    expect(folderKey("C:\\Dev\\Shop\\")).toBe("c:/dev/shop")
  })

  it("never remembers an Extreme approval mode", () => {
    rememberChoices("C:\\dev\\shop", { model: "", effort: "", mode: "extreme" })
    expect(choicesFor("C:\\dev\\shop").mode).toBeUndefined()
    rememberChoices("C:\\dev\\shop", { model: "", effort: "", mode: "extremeMax" })
    expect(choicesFor().mode).toBeUndefined()
  })

  it("starts as usual when what was kept cannot be read", () => {
    localStorage.setItem("gatehouse.newSession.v1", "{not json")
    expect(choicesFor()).toEqual({})
  })
})
