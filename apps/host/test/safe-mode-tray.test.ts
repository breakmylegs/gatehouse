// The tray's "Start in safe mode" (E-096): the window app starts again with GATEHOUSE_SAFE_MODE=1 for the new Host,
// and every other restart takes it away, so safe mode never sticks to later starts. The Host's own handling of the flag
// is E-096's test (safe-mode.test.ts).
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const app = fs.readFileSync(path.resolve(import.meta.dirname, "../../../packaging/CodehouseApp.cs"), "utf8").replace(/\r\n/g, "\n")

describe("starting in safe mode from the tray", () => {
  it("has a tray item that starts Codehouse again in safe mode", () => {
    expect(app).toMatch(/menu\.Items\.Add\("Start in safe mode", null, delegate \{ Restart\(true\); \}\);/)
  })

  it("sets the flag only for that start, and clears it on every other restart", () => {
    const body = app.slice(app.indexOf("private void Restart(bool safe)"), app.indexOf("private void Quit()"))
    expect(body).toMatch(/if \(safe\) psi\.EnvironmentVariables\["GATEHOUSE_SAFE_MODE"\] = "1";\n\s+else psi\.EnvironmentVariables\.Remove\("GATEHOUSE_SAFE_MODE"\);/)
    expect(app).toMatch(/private void Restart\(\) \{ Restart\(false\); \}/)
  })
})

// Owner, 25 Nov: the Mac's menu layout on Windows. The tray is grouped as the Mac's status menu (AppDelegate.swift):
// open and the quick prompt; what shows and how Codehouse starts, Open at sign-in among them as the Mac's Open at Login;
// then quit.
describe("the tray, laid out as the Mac's menu", () => {
  it("groups its items as the Mac does, with Open at sign-in", () => {
    const menu = app.slice(app.indexOf("ContextMenuStrip menu = new ContextMenuStrip();"), app.indexOf("tray.ContextMenuStrip = menu;"))
    const order = [
      "\"Open Codehouse\"",
      "\"Quick prompt\"",
      "new ToolStripSeparator()",
      "\"Show requests at the top of the screen\"",
      "\"Open at sign-in\"",
      "menu.Items.Add(signInItem);",
      "\"Screen-share safe mode\"",
      "\"Start in safe mode\"",
      "new ToolStripSeparator()",
      "\"Quit Codehouse\"",
    ]
    let at = 0
    for (const item of order) {
      const next = menu.indexOf(item, at)
      expect(next, item).toBeGreaterThan(-1)
      at = next + item.length
    }
  })

  it("ticks Open at sign-in for the installer's Startup shortcut, and makes or removes that same shortcut", () => {
    // The installer's shortcut (installer.iss: {userstartup}\Codehouse, with --tray).
    expect(app).toContain(`Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Codehouse.lnk")`)
    expect(app).toContain(`signInItem.Checked = File.Exists(SignInShortcut);`)
    const body = app.slice(app.indexOf("private void SetSignIn(bool on)"), app.indexOf("private void Restart(bool safe)"))
    expect(body).toContain(`File.Delete(SignInShortcut)`)
    expect(body).toContain(`"Arguments", System.Reflection.BindingFlags.SetProperty, null, link, new object[] { "--tray" }`)
    expect(body).toContain(`"Save", System.Reflection.BindingFlags.InvokeMethod`)
  })
})

