// T-091: project actions. Yours and the repository's are read tolerantly (one line, a name, a preview only on this
// computer); the repository's own come from .codehouse/actions.json and are never run by anything but your request.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { checkActions, isLocalPreview, repoActions } from "../src/project-actions.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-actions-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe("project actions (T-091)", () => {
  it("keeps only one-line actions with a name, and a preview only on this computer", () => {
    expect(
      checkActions([
        { name: "Dev server", command: "npm run dev", preview: "http://localhost:5173" },
        { name: "Setup", command: "npm ci", kind: "setup" },
        { name: "Two lines", command: "npm test\nrm -rf /" },
        { name: "", command: "x" },
        { name: "Elsewhere", command: "npm start", preview: "https://evil.example" },
        "nonsense",
      ]),
    ).toEqual([
      { name: "Dev server", command: "npm run dev", kind: "run", preview: "http://localhost:5173" },
      { name: "Setup", command: "npm ci", kind: "setup" },
      { name: "Elsewhere", command: "npm start", kind: "run" },
    ])
    expect(["http://127.0.0.1:3000/app", "http://[::1]:8080"].every(isLocalPreview)).toBe(true)
    expect(["http://localhost.evil.example", "file:///C:/x", "http://10.0.0.1"].some(isLocalPreview)).toBe(false)
  })

  it("reads the repository's own from .codehouse/actions.json, and none when it is missing or unreadable", () => {
    expect(repoActions(root)).toEqual([])
    fs.mkdirSync(path.join(root, ".codehouse"))
    fs.writeFileSync(path.join(root, ".codehouse", "actions.json"), JSON.stringify({ actions: [{ name: "Seed", command: "npm run seed", kind: "setup" }] }))
    expect(repoActions(root)).toEqual([{ name: "Seed", command: "npm run seed", kind: "setup" }])
    fs.writeFileSync(path.join(root, ".codehouse", "actions.json"), "{ not json")
    expect(repoActions(root)).toEqual([])
  })
})
