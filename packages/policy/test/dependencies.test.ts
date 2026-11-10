// D-053, dependency admission: what a call adds, what the project already uses, and the judgement on the rest.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { admit, distance, fromCommand, fromManifestEdit, knownDependencies, nearPopular } from "../src/dependencies.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-deps-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("dependency admission (D-053)", () => {
  it("reads what install commands add, by name, leaving out flags, paths and addresses", () => {
    expect(fromCommand("npm install lodash@4 @scope/x@1.2 --save-dev ./local.tgz").map((d) => d.name)).toEqual(["lodash", "@scope/x"])
    expect(fromCommand("python -m pip install requests==2.31 -r requirements.txt flask").map((d) => d.name)).toEqual(["requests", "flask"])
    expect(fromCommand("dotnet add package Serilog --version 3.0.0").map((d) => [d.ecosystem, d.name])).toEqual([["nuget", "Serilog"]])
    expect(fromCommand("git status && npm test")).toEqual([])
  })

  it("reads what an edit of a manifest adds, and not what it already had", () => {
    expect(fromManifestEdit("package.json", '"a": "^1"', '"a": "^2",\n"b": "~3"').map((d) => d.name)).toEqual(["b"])
    expect(fromManifestEdit("proj.csproj", "", '<PackageReference Include="Polly" Version="8" />').map((d) => d.name)).toEqual(["Polly"])
    expect(fromManifestEdit("pyproject.toml", "", 'dependencies = [\n  "httpx>=0.27",\n]').map((d) => d.name)).toEqual(["httpx"])
  })

  it("lets through what the lockfile or the manifest has, and what the owner approved", () => {
    const p = path.join(dir, "p")
    fs.mkdirSync(p, { recursive: true })
    fs.writeFileSync(path.join(p, "package-lock.json"), JSON.stringify({ packages: { "node_modules/react": {}, "node_modules/@types/node": {} } }))
    fs.writeFileSync(path.join(p, "requirements.txt"), "Django==5\n")
    const known = knownDependencies([p])
    const added = [
      { ecosystem: "npm" as const, name: "react", via: "the command" },
      { ecosystem: "npm" as const, name: "@types/node", via: "the command" },
      { ecosystem: "pypi" as const, name: "django", via: "the command" },
      { ecosystem: "npm" as const, name: "my-internal-lib", via: "the command" },
    ]
    expect(admit(added, known, new Set()).map((f) => f.reason)).toEqual([
      expect.stringContaining("my-internal-lib"),
    ])
    expect(admit(added, known, new Set(["npm:my-internal-lib"]))).toEqual([])
  })

  it("names a near miss, and leaves a popular name alone", () => {
    expect(distance("lodahs", "lodash")).toBe(1)
    expect(nearPopular("npm", "reactt")).toEqual({ name: "react", distance: 1 })
    expect(nearPopular("npm", "react")).toBeUndefined()
    expect(nearPopular("npm", "completely-different")).toBeUndefined()
  })
})
