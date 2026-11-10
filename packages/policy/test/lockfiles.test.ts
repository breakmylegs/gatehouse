// D-054, the lockfile diff guard: what an edit of a lockfile changes that matters, shown in the reason.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { isLockfile, lockfileEdit } from "../src/lockfiles.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-locks-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the lockfile diff guard (D-054)", () => {
  it("shows the install script of a package that gains one, where it is installed here", () => {
    fs.mkdirSync(path.join(dir, "node_modules", "evil"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "node_modules", "evil", "package.json"),
      JSON.stringify({ name: "evil", scripts: { postinstall: "node steal.js" } }),
    )
    const before = JSON.stringify({ packages: { "node_modules/evil": { version: "1.0.0" } } }, null, 2)
    const after = JSON.stringify({ packages: { "node_modules/evil": { version: "1.0.0", hasInstallScript: true } } }, null, 2)
    const f = lockfileEdit(path.join(dir, "package-lock.json"), before, after, dir)!
    expect(f.ruleId).toBe("lockfile-edited")
    expect(f.risk).toBe(80)
    expect(f.reason).toContain("evil (postinstall: node steal.js)")
  })

  it("names a source that is not the registry, and asks even for a change with nothing else in it", () => {
    const src = lockfileEdit("yarn.lock", '  resolved "https://registry.yarnpkg.com/a.tgz"', '  resolved "https://evil.example/a.tgz"', dir)!
    expect(src.reason).toContain("https://evil.example/a.tgz")
    const plain = lockfileEdit("Cargo.lock", 'version = "1.0.0"', 'version = "1.0.1"', dir)!
    expect(plain).toMatchObject({ ruleId: "lockfile-edited", risk: 70 })
    expect(plain.reason).toContain("no change to the manifest")
    expect(lockfileEdit("package.json", "a", "b", dir)).toBeUndefined()
    expect([isLockfile("a/b/pnpm-lock.yaml"), isLockfile("go.sum"), isLockfile("package.json")]).toEqual([true, true, false])
  })
})
