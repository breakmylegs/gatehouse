import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The desktop screen runs in a browser. A value import from the shared package's main entry, its node or audit
 * parts, or a node: module, loads Node's crypto or fs and leaves a blank window (30 Oct: the new project form
 * imported the folder-name helper from "@gatehouse/shared"). The tests run under Node, so only this check sees it.
 * Type-only imports are fine: they vanish in the build. The pattern cannot run past the quotes of another import.
 */
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src")
const NODE_ONLY =
  /^import\s+(?!type\s)[^"']*?\sfrom\s+"(@gatehouse\/shared(?:\/node|\/audit)?|node:[^"]+)"/gm

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : []
  })
}

describe("code the browser runs", () => {
  it("never imports Node-only modules", () => {
    const all = files(src)
    // A check that reads nothing proves nothing.
    expect(all.length).toBeGreaterThan(50)
    let browserSafe = 0
    const offenders: string[] = []
    for (const f of all) {
      const text = fs.readFileSync(f, "utf8")
      browserSafe += (
        text.match(/from "@gatehouse\/shared\/(ws-protocol|highlight|project-name)"/g) ?? []
      ).length
      for (const m of text.matchAll(NODE_ONLY))
        offenders.push(`${path.relative(src, f)}: ${m[0].replace(/\s+/g, " ")}`)
    }
    expect(browserSafe).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
