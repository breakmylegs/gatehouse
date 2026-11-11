// D-056, an SBOM per change: a change to the lockfiles becomes a CycloneDX 1.6 document of what was added, changed and
// removed, made by Codehouse itself from the lockfiles' text, and valid against the CycloneDX 1.6 schema.
import fs from "node:fs"
import path from "node:path"
import { Ajv } from "ajv"
import addFormats from "ajv-formats"
import { describe, expect, it } from "vitest"
import { lockedPackages, lockfileChanges, purlOf, sbomDiff } from "../src/sbom.js"

const SCHEMAS = path.join(import.meta.dirname, "fixtures", "cyclonedx")
const schema = (f: string) => JSON.parse(fs.readFileSync(path.join(SCHEMAS, f), "utf8")) as object

function validator() {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true })
  ;(addFormats as unknown as (a: Ajv) => void)(ajv)
  ajv.addSchema(schema("spdx.schema.json"), "spdx.schema.json")
  ajv.addSchema(schema("jsf-0.82.schema.json"), "jsf-0.82.schema.json")
  return ajv.compile(schema("bom-1.6.schema.json"))
}

const npmBefore = JSON.stringify({
  name: "shop",
  lockfileVersion: 3,
  packages: {
    "": { name: "shop", dependencies: { "left-pad": "^1.0.0", lodash: "^4.17.0" } },
    "node_modules/left-pad": { version: "1.3.0", integrity: "sha512-AAAA" },
    "node_modules/lodash": { version: "4.17.20", integrity: "sha512-BBBB" },
    "node_modules/old-thing": { version: "0.1.0" },
  },
})
const npmAfter = JSON.stringify({
  name: "shop",
  lockfileVersion: 3,
  packages: {
    "": { name: "shop" },
    "node_modules/left-pad": { version: "1.3.0", integrity: "sha512-AAAA" },
    "node_modules/lodash": { version: "4.17.21", integrity: "sha512-CCCC" },
    "node_modules/@types/node": { version: "22.1.0" },
    "packages/app": { name: "app", version: "1.0.0" },
    "node_modules/app": { link: true, resolved: "packages/app" },
  },
})

describe("the SBOM of a change (D-056)", () => {
  it("lists what the change adds, changes and removes, from npm's lockfile", () => {
    const changes = lockfileChanges("package-lock.json", npmBefore, npmAfter)
    const by = Object.fromEntries(changes.map((c) => [c.package.name, c]))
    expect(by["lodash"]).toMatchObject({ kind: "changed", previousVersion: "4.17.20", package: { version: "4.17.21" } })
    expect(by["@types/node"]).toMatchObject({ kind: "added" })
    expect(by["old-thing"]).toMatchObject({ kind: "removed" })
    expect(by["left-pad"]).toBeUndefined()
    // The workspace's own package is a dependency of nothing outside it.
    expect(changes.find((c) => c.package.name === "app" && c.kind !== "added")).toBeUndefined()
    expect(purlOf({ ecosystem: "npm", name: "@types/node", version: "22.1.0" })).toBe("pkg:npm/%40types/node@22.1.0")
  })

  it("reads the other common lockfiles", () => {
    expect(lockedPackages("yarn.lock", '# yarn lockfile v1\n\n"left-pad@^1.3.0":\n  version "1.3.0"\n  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"\n  integrity sha512-AAAA\n')).toEqual([
      { ecosystem: "npm", name: "left-pad", version: "1.3.0", hash: "sha512-AAAA" },
    ])
    expect(lockedPackages("pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages:\n  left-pad@1.3.0:\n    resolution: {integrity: sha512-AAAA}\n")).toEqual([
      { ecosystem: "npm", name: "left-pad", version: "1.3.0", hash: "sha512-AAAA" },
    ])
    expect(lockedPackages("Cargo.lock", '[[package]]\nname = "serde"\nversion = "1.0.200"\nchecksum = "abc"\n')).toEqual([
      { ecosystem: "cargo", name: "serde", version: "1.0.200", hash: "abc" },
    ])
    expect(lockedPackages("poetry.lock", '[[package]]\nname = "Requests"\nversion = "2.32.0"\n')?.[0]).toMatchObject({ ecosystem: "pypi", name: "Requests" })
    expect(lockedPackages("go.sum", "golang.org/x/text v0.14.0 h1:abc=\ngolang.org/x/text v0.14.0/go.mod h1:def=\n")).toHaveLength(1)
    expect(lockedPackages("packages.lock.json", JSON.stringify({ version: 1, dependencies: { "net8.0": { "Newtonsoft.Json": { type: "Direct", resolved: "13.0.3" } } } }))).toEqual([
      { ecosystem: "nuget", name: "Newtonsoft.Json", version: "13.0.3" },
    ])
    expect(lockedPackages("Gemfile.lock", "GEM\n  specs:\n    rake (13.2.1)\n")).toEqual([{ ecosystem: "gem", name: "rake", version: "13.2.1" }])
    // A half-written lockfile lists nothing, and a file that is not one is not read.
    expect(lockedPackages("package-lock.json", "{ not json")).toEqual([])
    expect(lockedPackages("README.md", "x")).toBeUndefined()
  })

  it("is a valid CycloneDX 1.6 document", () => {
    const changes = [
      ...lockfileChanges("package-lock.json", npmBefore, npmAfter),
      ...lockfileChanges("Cargo.lock", "", '[[package]]\nname = "serde"\nversion = "1.0.200"\nchecksum = "' + "a".repeat(64) + '"\n'),
    ]
    const bom = sbomDiff(changes, { project: "shop", version: "2.0.212", describe: "changes since a checkpoint" })
    const validate = validator()
    const ok = validate(bom)
    expect(validate.errors ?? []).toEqual([])
    expect(ok).toBe(true)
    expect(bom).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.6" })
    // And the schema really is checked: a document missing its format is refused.
    expect(validate({ ...bom, bomFormat: undefined })).toBe(false)
  })
})
