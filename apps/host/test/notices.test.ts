// E-070: every fixture dependency is listed with its licence, its notice texts are included, and what is missing is said.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { collectNotices, noticesText } from "../src/notices.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-notices-"))
  dirs.push(root)
  const pkg = (where: string, json: Record<string, unknown>, files: Record<string, string> = {}) => {
    const d = path.join(root, ...where.split("/"))
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify(json))
    for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(d, f), t)
  }
  pkg("node_modules/left-pad", { name: "left-pad", license: "MIT" }, { LICENSE: "MIT Licence, Copyright left-pad" })
  pkg("node_modules/@scope/kit", { name: "@scope/kit", license: { type: "Apache-2.0" } }, { "LICENSE.txt": "Apache text", NOTICE: "Kit notice", "LICENSE-MIT": "Kit MIT text", "index.js": "" })
  pkg("node_modules/@scope/kit/node_modules/left-pad", { name: "left-pad", licenses: [{ type: "MIT" }, { type: "ISC" }] }, { "licence.md": "older left-pad" })
  pkg("node_modules/bare", { name: "bare" })
  pkg("node_modules/vitest", { name: "vitest", license: "MIT" })
  fs.writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "app" },
        "node_modules/left-pad": { version: "1.3.0", license: "MIT" },
        "node_modules/@scope/kit": { version: "2.0.0" },
        "node_modules/@scope/kit/node_modules/left-pad": { version: "1.0.0" },
        "node_modules/bare": { version: "0.1.0" },
        "node_modules/ghost": { version: "3.0.0", license: "BSD-3-Clause" },
        "node_modules/vitest": { version: "5.0.5", dev: true },
      },
    }),
  )
  return root
}

describe("third-party notices", () => {
  it("lists every shipped fixture dependency with its licence, and leaves out development ones", () => {
    const n = collectNotices(fixture())
    expect(n.entries.map((e) => [e.name, e.version, e.licence])).toEqual([
      ["@scope/kit", "2.0.0", "Apache-2.0"],
      ["bare", "0.1.0", undefined],
      ["ghost", "3.0.0", "BSD-3-Clause"],
      ["left-pad", "1.0.0", "(MIT OR ISC)"],
      ["left-pad", "1.3.0", "MIT"],
    ])
    expect(n.entries.find((e) => e.name === "@scope/kit")!.texts.map((t) => t.file)).toEqual(["LICENSE-MIT", "LICENSE.txt", "NOTICE"])
  })

  it("lists what is missing: no licence stated, no notice file, not installed", () => {
    const n = collectNotices(fixture())
    expect(n.missing).toEqual(["bare@0.1.0: no licence stated; no licence or notice file in the package", "ghost@3.0.0: not installed, so its notice files could not be read"])
  })

  it("writes a notices file with each licence and notice text", () => {
    const text = noticesText("app", collectNotices(fixture()))
    expect(text).toMatch(/^- @scope\/kit 2\.0\.0: Apache-2\.0$/m)
    expect(text).toMatch(/^- bare 0\.1\.0: licence not stated$/m)
    expect(text).toMatch(/Missing \(to resolve before this file is complete\):\n- bare@0\.1\.0/)
    expect(text).toContain("Kit notice")
    expect(text).toContain("MIT Licence, Copyright left-pad")
    expect(text).not.toContain("vitest")
  })

  it("says so when there is no lockfile to read", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-notices-"))
    dirs.push(root)
    expect(collectNotices(root)).toMatchObject({ entries: [], none: expect.stringMatching(/package-lock\.json/) })
  })
})
