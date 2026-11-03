import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { workspaceEntries } from "../../../scripts/workspace-aliases.mjs"

const REPO = path.resolve(import.meta.dirname, "../../..")

// The tools find the @gatehouse packages in their folders, not through the node_modules links, which a process with
// Windows' redirection guard on cannot follow (3 Nov). tsc, tsx and esbuild read tsconfig.base.json; Vite and Vitest
// read the packages' own entry points. Both must name the same files.
describe("where the workspace packages are found", () => {
  const paths = (
    JSON.parse(fs.readFileSync(path.join(REPO, "tsconfig.base.json"), "utf8")) as {
      compilerOptions: { paths: Record<string, string[]> }
    }
  ).compilerOptions.paths
  const entries = workspaceEntries()

  it("is the same for tsc and esbuild as each package's own exports say, for every entry point", () => {
    const fromPackages = Object.fromEntries(
      entries.map(([name, file]) => [name, path.resolve(file)]),
    )
    const fromTsconfig = Object.fromEntries(
      Object.entries(paths).map(([name, [file]]) => [name, path.resolve(REPO, file!)]),
    )
    expect(fromTsconfig).toEqual(fromPackages)
  })

  it("names only files that exist", () => {
    for (const [name, file] of entries) expect(fs.existsSync(file), name).toBe(true)
  })

  it("covers every @gatehouse import in the code", () => {
    const names = new Set(entries.map(([n]) => n))
    const seen = new Set<string>()
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue
        const at = path.join(dir, e.name)
        if (e.isDirectory()) walk(at)
        else if (/\.(ts|tsx|mjs)$/.test(e.name))
          for (const m of fs
            .readFileSync(at, "utf8")
            .matchAll(/["'](@gatehouse\/[a-z-]+(?:\/[a-z-]+)?)["']/g))
            seen.add(m[1]!)
      }
    }
    for (const d of ["apps", "packages"]) walk(path.join(REPO, d))
    const missing = [...seen].filter(
      (n) => !names.has(n) && !/^@gatehouse\/(web|phone|host|relay|approver)$/.test(n),
    )
    expect(missing).toEqual([])
  })
})
