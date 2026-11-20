// T-137: a picture of the window you were in carries its program and title: read from the window app's message,
// made one line and short, and used for the attachment's name and a line in the message. The window app and the page
// use the same message names.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { pictureLine, pictureName, readWindowFrom } from "../src/lib/window-from"

const repo = path.resolve(import.meta.dirname, "../../..")

describe("the window in a picture (T-137)", () => {
  it("reads the program and title, one line and short, and ignores anything else", () => {
    expect(readWindowFrom('captured-from:{"app":"Microsoft Excel","title":"Budget.xlsx  -  Excel"}')).toEqual({ app: "Microsoft Excel", title: "Budget.xlsx - Excel" })
    expect(readWindowFrom(`captured-from:{"app":"x","title":"${"a".repeat(300)}"}`)!.title).toHaveLength(200)
    expect(readWindowFrom('captured-from:{"app":"a\\nb","title":""}')).toEqual({ app: "a b", title: "" })
    expect(readWindowFrom('captured-from:{"app":"","title":""}')).toBeUndefined()
    expect(readWindowFrom("captured-from:not json")).toBeUndefined()
    expect(readWindowFrom("captured:AAAA")).toBeUndefined()
  })

  it("names the attachment after the program and says what the picture is", () => {
    expect(pictureName({ app: "Microsoft Excel", title: "" })).toBe("Microsoft-Excel.png")
    expect(pictureName({ app: "..\\..\\evil", title: "" })).toBe("evil.png")
    expect(pictureName({ app: "", title: "t" })).toBe("screen.png")
    expect(pictureName(undefined)).toBe("screen.png")
    expect(pictureLine({ app: "Microsoft Excel", title: "Budget.xlsx" })).toBe("(A picture of Microsoft Excel: Budget.xlsx)")
    expect(pictureLine(undefined)).toBe("")
  })

  it("is what the window app sends, and its Shift shortcut is what Settings listens for", () => {
    const overlay = fs.readFileSync(path.join(repo, "packaging", "Overlay.cs"), "utf8")
    const app = fs.readFileSync(path.join(repo, "packaging", "CodehouseApp.cs"), "utf8")
    const key = fs.readFileSync(path.join(repo, "apps", "web", "src", "lib", "quickKey.ts"), "utf8")
    expect(overlay).toContain('"captured-from:" + WindowFrom(before)')
    expect(app).toContain('"hotkey-snap:"')
    expect(app).toContain('"hotkey-snap-none"')
    expect(key).toContain('m.startsWith("hotkey-snap:")')
    // The picture shortcut is Shift added to yours, only when yours has no Shift.
    expect(app).toMatch(/\(hotkeyMods & Hotkey\.ModShift\) == 0/)
  })
})
