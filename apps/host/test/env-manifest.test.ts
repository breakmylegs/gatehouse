// E-025: what a project asks for against what this computer has, with environment variables by name only.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { drift, makeManifest, projectPins, satisfies, saveManifest, type Run } from "../src/env-manifest.js"

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-env-"))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const fake: Run = async (file, args) => {
  const name = path.basename(file).toLowerCase()
  if (name.startsWith("node")) return "v24.15.0"
  if (file === "npm") return "11.6.2"
  if (file === "git") return "git version 2.53.0.windows.1"
  if (file === "dotnet" && args[0] === "--list-sdks") return "8.0.404 [C:\\Program Files\\dotnet\\sdk]\n9.0.100 [C:\\Program Files\\dotnet\\sdk]"
  return ""
}

describe("the environment manifest", () => {
  it("reads versions in the common range forms", () => {
    expect(satisfies("24.15.0", "22")).toBe(false)
    expect(satisfies("22.11.0", "22")).toBe(true)
    expect(satisfies("22.11.0", "22.x")).toBe(true)
    expect(satisfies("24.15.0", ">=18")).toBe(true)
    expect(satisfies("24.15.0", ">=18 <23")).toBe(false)
    expect(satisfies("24.15.0", "^22.1 || ^24")).toBe(true)
    expect(satisfies("22.1.5", "~22.1.0")).toBe(true)
    expect(satisfies("22.2.0", "~22.1.0")).toBe(false)
  })

  it("reports engines asking for Node 22 on a computer running Node 24 as drift, and a global.json SDK not installed", async () => {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: "22", npm: ">=10" } }))
    fs.writeFileSync(path.join(root, "global.json"), JSON.stringify({ sdk: { version: "10.0.100" } }))
    fs.writeFileSync(path.join(root, ".nvmrc"), "v24\n")
    expect(projectPins(root)).toEqual({ "node (.nvmrc)": "24", "dotnet (global.json)": "10.0.100", "node (engines)": "22", "npm (engines)": ">=10" })
    const m = await makeManifest(root, {}, fake, new Date("2026-11-22T10:00:00Z"))
    expect(m.tools).toEqual({ node: "24.15.0", npm: "11.6.2", git: "2.53.0", dotnet: "9.0.100" })
    expect(drift(m)).toEqual([
      { tool: "dotnet", wanted: "10.0.100", from: "global.json", have: "8.0.404, 9.0.100" },
      { tool: "node", wanted: "22", from: "engines", have: "24.15.0" },
    ])
  })

  it("keeps environment variables by name and never stores a value", async () => {
    const secret = "sk-live-not-a-real-value-4f9a8c"
    const m = await makeManifest(root, { PATH: "C:\\bin", DEPLOY_TOKEN: secret, HOME: "C:\\Users\\me" }, fake)
    expect(m.variables).toEqual(["DEPLOY_TOKEN", "HOME", "PATH"])
    const file = await saveManifest(root, m)
    const text = fs.readFileSync(file, "utf8")
    expect(file).toBe(path.join(root, ".codehouse", "environment.json"))
    expect(text).toContain("DEPLOY_TOKEN")
    expect(text).not.toContain(secret)
    expect(text).not.toContain("C:\\\\bin")
  })
})
