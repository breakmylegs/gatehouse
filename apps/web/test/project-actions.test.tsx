// @vitest-environment jsdom
// T-091: your project actions are written one a line, "name: command", with an optional preview on this computer.
import { describe, expect, it } from "vitest"
import { parseAction } from "../src/components/ProjectActions"

describe("writing your project actions (T-091)", () => {
  it("reads a name, a command and a preview on this computer, and nothing else", () => {
    expect(parseAction("Dev server: npm run dev @ http://localhost:5173")).toEqual({ name: "Dev server", command: "npm run dev", kind: "run", preview: "http://localhost:5173" })
    expect(parseAction("Setup: npm ci")).toEqual({ name: "Setup", command: "npm ci", kind: "setup" })
    expect(parseAction("Tests: npm test -- --run")).toEqual({ name: "Tests", command: "npm test -- --run", kind: "run" })
    expect(parseAction("Remote: npm start @ https://evil.example")).toEqual({ name: "Remote", command: "npm start @ https://evil.example", kind: "run" })
    expect(parseAction("no colon here")).toBeUndefined()
    expect(parseAction("Empty:   ")).toBeUndefined()
  })
})
