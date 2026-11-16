// O37: the Windows wing (packaging/Wing.cs) hosts the same page as the Mac's beside the notch (NotchMac.tsx). This keeps
// the two in step: every message the page sends its window is one Wing.cs handles, the page is told it has no notch,
// a request to open is passed on only by its id, and the wing never takes the focus or a taskbar button.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const wing = fs.readFileSync(path.join(root, "packaging", "Wing.cs"), "utf8")
const page = fs.readFileSync(path.join(root, "apps", "web", "src", "surfaces", "NotchMac.tsx"), "utf8")
const app = fs.readFileSync(path.join(root, "packaging", "CodehouseApp.cs"), "utf8")

describe("the Windows wing (O37)", () => {
  it("handles every message the page sends, and tells the page it has no notch", () => {
    const sent = [...page.matchAll(/tellShell\(`?"?(notch[-:][a-z]+:?)/g)].map((m) => m[1]!)
    expect(new Set(sent)).toEqual(new Set(["notch:hide", "notch:size:", "notch-open:"]))
    for (const m of sent) expect(wing, m).toContain(`"${m}"`)
    expect(wing).toContain('PostWebMessageAsString("notch-place:free")')
    expect(page).toContain('"notch-place:free"')
  })

  it("passes on only a request id, and opens it in the main window the way the Mac does", () => {
    expect(wing).toMatch(/if \(RequestId\.IsMatch\(id\)\) onOpen\(id\)/)
    expect(app).toContain('PostWebMessageAsString("open-request:" + id)')
    expect(fs.readFileSync(path.join(root, "apps", "web", "src", "lib", "quickKey.ts"), "utf8")).toContain('m.startsWith("open-request:")')
  })

  it("never takes the focus or a taskbar button, is built into the window, and can be turned off from the tray", () => {
    expect(wing).toContain("ShowWithoutActivation { get { return true; } }")
    expect(wing).toMatch(/WS_EX_NOACTIVATE/)
    expect(wing).toMatch(/ShowInTaskbar = false/)
    expect(fs.readFileSync(path.join(root, "scripts", "package.mjs"), "utf8")).toContain('pk("Wing.cs")')
    expect(app).toContain('"Show requests at the top of the screen"')
  })
})
