// D-055, licence policy: SPDX expressions against the allowed list, licences read from what this computer has, and
// the findings for the rest.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { DEFAULT_LICENCES, LICENCE_NOT_ALLOWED, LICENCE_UNKNOWN, licenceAllowed, licenceFindings, licenceOf } from "../src/licences.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-lic-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const put = (rel: string, text: string) => {
  const f = path.join(dir, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, text)
}
const npm = (name: string) => ({ ecosystem: "npm" as const, name, via: "the command" })

describe("licence policy (D-055)", () => {
  it("reads SPDX expressions: OR needs one side, AND both, WITH and + count as the licence", () => {
    expect(licenceAllowed("MIT", DEFAULT_LICENCES)).toBe(true)
    expect(licenceAllowed("mit", DEFAULT_LICENCES)).toBe(true)
    expect(licenceAllowed("GPL-3.0-only", DEFAULT_LICENCES)).toBe(false)
    expect(licenceAllowed("(MIT OR GPL-3.0)", DEFAULT_LICENCES)).toBe(true)
    expect(licenceAllowed("MIT AND GPL-3.0", DEFAULT_LICENCES)).toBe(false)
    expect(licenceAllowed("(MIT OR Apache-2.0) AND BSD-3-Clause", DEFAULT_LICENCES)).toBe(true)
    expect(licenceAllowed("Apache-2.0 WITH LLVM-exception", DEFAULT_LICENCES)).toBe(true)
    expect(licenceAllowed("MIT/Apache-2.0", DEFAULT_LICENCES)).toBe(true)
    // npm's word for a package with no licence to use it is not the Unlicense.
    expect(licenceAllowed("UNLICENSED", DEFAULT_LICENCES)).toBe(false)
    // Not an expression: unknown, never allowed.
    expect(licenceAllowed("SEE LICENSE IN LICENSE.txt", DEFAULT_LICENCES)).toBeUndefined()
    expect(licenceAllowed("(MIT", DEFAULT_LICENCES)).toBeUndefined()
    expect(licenceAllowed("", DEFAULT_LICENCES)).toBeUndefined()
  })

  it("reads a licence from node_modules, the lockfile, a Python environment, NuGet and Cargo", () => {
    const p = path.join(dir, "proj")
    put("proj/node_modules/@acme/a/package.json", JSON.stringify({ license: "GPL-3.0" }))
    put("proj/node_modules/old/package.json", JSON.stringify({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }))
    put("proj/package-lock.json", JSON.stringify({ packages: { "node_modules/locked": { license: "ISC" } } }))
    put("proj/.venv/Lib/site-packages/My_Pkg-1.0.dist-info/METADATA", "Name: my-pkg\nLicense-Expression: BSD-3-Clause\n")
    put("proj/.venv/Lib/site-packages/troved-2.0.dist-info/METADATA", "Classifier: License :: OSI Approved :: GNU General Public License v3 (GPLv3)\n")
    put("home/.nuget/packages/serilog/3.0.0/serilog.nuspec", '<package><metadata><license type="expression">Apache-2.0</license></metadata></package>')
    put("home/.cargo/registry/src/index.crates.io-1/serde-1.0.200/Cargo.toml", 'name = "serde"\nlicense = "MIT OR Apache-2.0"\n')
    const home = path.join(dir, "home")
    expect(licenceOf(npm("@acme/a"), [p], home)).toBe("GPL-3.0")
    expect(licenceOf(npm("old"), [p], home)).toBe("MIT OR Apache-2.0")
    expect(licenceOf(npm("locked"), [p], home)).toBe("ISC")
    expect(licenceOf(npm("absent"), [p], home)).toBeUndefined()
    expect(licenceOf({ ecosystem: "pypi", name: "my.pkg", via: "x" }, [p], home)).toBe("BSD-3-Clause")
    expect(licenceOf({ ecosystem: "pypi", name: "troved", via: "x" }, [p], home)).toBe("GPL-3.0")
    expect(licenceOf({ ecosystem: "nuget", name: "Serilog", via: "x" }, [p], home)).toBe("Apache-2.0")
    expect(licenceOf({ ecosystem: "cargo", name: "serde", via: "x" }, [p], home)).toBe("MIT OR Apache-2.0")
    expect(licenceOf({ ecosystem: "go", name: "github.com/x/y", via: "x" }, [p], home)).toBeUndefined()
  })

  it("asks about a GPL-3.0 dependency and an unknown one, and lets an allowed or accepted one through", () => {
    const p = path.join(dir, "proj")
    const home = path.join(dir, "home")
    const out = licenceFindings([npm("@acme/a"), npm("absent"), npm("old"), npm("locked")], [p], DEFAULT_LICENCES, home)
    expect(out.map((f) => [f.dependency, f.ruleId])).toEqual([
      ["npm:@acme/a", LICENCE_NOT_ALLOWED],
      ["npm:absent", LICENCE_UNKNOWN],
    ])
    expect(out[0]!.reason).toContain("GPL-3.0")
    // GPL is allowed when the list says so, and a package is accepted by name whatever its licence.
    expect(licenceFindings([npm("@acme/a")], [p], [...DEFAULT_LICENCES, "GPL-3.0"], home)).toEqual([])
    expect(licenceFindings([npm("absent")], [p], [...DEFAULT_LICENCES, "npm:absent"], home)).toEqual([])
  })
})
