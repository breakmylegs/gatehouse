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
