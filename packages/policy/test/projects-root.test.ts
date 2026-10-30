import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { PolicyEngine } from "../src/engine.js"
import { loadPolicy } from "../src/loader.js"
import { fwd, makeFixture, SEED_RULES } from "./helpers.js"

const fx = makeFixture()
const projects = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-projects-")))
afterAll(() => {
  fx.dispose()
  fs.rmSync(projects, { recursive: true, force: true })
})

describe("the projects folder from the settings", () => {
  it("counts as a workspace root, so a new project's code can be edited", async () => {
    const file = path.join(projects, "html-excel", "src", "app.ts")
    const decide = (extra?: string[]) => {
      const policy = loadPolicy({
        rulesPath: SEED_RULES,
        workspaceRootsOverride: [fwd(fx.ws)],
        ...(extra ? { extraWorkspaceRoots: extra } : {}),
      })
      return new PolicyEngine({ getPolicy: () => policy }).evaluate(
        { toolName: "Edit", input: { file_path: file, old_string: "a", new_string: "b" } },
        { cwd: path.join(projects, "html-excel") },
      )
    }
    expect(await decide()).toMatchObject({ outcome: "deny", ruleId: "outside-workspace-write" })
    expect(await decide([projects])).toMatchObject({ outcome: "allow", ruleId: "edit-workspace-source" })
  })

  it("is listed once, whichever slashes and case it was written with", () => {
    const policy = loadPolicy({
      rulesPath: SEED_RULES,
      workspaceRootsOverride: [fwd(fx.ws)],
      extraWorkspaceRoots: [fx.ws.replace(/\//g, "\\").toUpperCase()],
    })
    expect(policy.rules.workspaceRoots).toHaveLength(1)
  })
})
