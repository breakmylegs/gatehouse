// CH-01 (owner's Chat build, 4 Nov): the prohibited-pattern check that npm run gate and npm run release run.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { scan, treeFiles } from "../../../scripts/forbidden.mjs"

const REPO = path.resolve(import.meta.dirname, "../../..")
let dir: string | undefined
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** A little tree with these files in it. The strings are put together here so this file holds none of them. */
function seeded(files: Record<string, string>) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-forbidden-"))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return scan(dir, Object.keys(files)).map((f) => `${f.file} ${f.id}`)
}

describe("the prohibited-pattern check", () => {
  it("passes on this tree", () => {
    expect(scan(REPO, treeFiles(REPO))).toEqual([])
  })

  it("fails on each seeded prohibited pattern", () => {
    const remote = "--remote-" + "debugging-port=9222"
    expect(
      seeded({
        "apps/host/src/a.ts": `fetch("https://claude.ai/" + "x"); const u = "https://claude" + ".ai/api/organizations"\nconst v = "https://claude.ai/api/x"`,
        "apps/host/src/b.ts": `spawn("msedge", ["${remote}"])`,
        "apps/host/src/c.ts": `import { chromium } from "play${"wright"}"`,
        "packaging/D.cs": "var jar = core.Cookie" + "Manager;",
        "apps/host/src/e.ts": `path.join(process.env.APPDATA, "Claude", "Local Storage")`,
        "apps/host/src/f.ts": `const p = "%LOCALAPPDATA%\\\\Claude-3p\\\\config.json"`,
        "apps/web/package.json": `{ "devDependencies": { "puppeteer": "24.0.0" } }`,
        "scripts/x.ps1": `Start-Process msedge "--load-extension=C:\\ext"`,
      }),
    ).toEqual([
      "apps/host/src/a.ts claude-private-api",
      "apps/host/src/b.ts browser-debugging",
      "apps/host/src/c.ts automation-library",
      "packaging/D.cs cookie-store",
      "apps/host/src/e.ts claude-app-data",
      "apps/host/src/f.ts claude-app-data",
      "apps/web/package.json automation-dependency",
      "scripts/x.ps1 browser-automation-flag",
    ])
  })

  it("lets the build's own screenshot check use a debugging port, but never on Anthropic's sites", () => {
    const remote = "--remote-" + "debugging-port=9222"
    expect(seeded({ "scripts/screenshots.ts": `args.push("${remote}")` })).toEqual([])
    expect(
      seeded({ "scripts/screenshots.ts": `args.push("${remote}"); go("https://claude" + ".ai/")` }),
    ).toEqual([])
    expect(
      seeded({ "scripts/screenshots.ts": `args.push("${remote}"); go("https://claude.ai/new")` }),
    ).toEqual(["scripts/screenshots.ts debugging-target"])
  })

  it("does not check documents, which quote the patterns to forbid them, nor an account's own folder", () => {
    expect(
      seeded({
        "docs/plan/x.md": "Never call claude.ai/api.",
        "README.md": "--load-extension",
        "apps/host/test/y.test.ts": `const acct = "C:/Users/a/AppData/Local/Gatehouse/accounts/ab12/claude/"`,
      }),
    ).toEqual([])
  })
})
