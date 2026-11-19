// D-082: a deleted symbol that CLAUDE.md still mentions is flagged, with the commit that removed it; so are a path that
// is not there and an npm script no package.json has. What still exists, plain words and fenced examples are not.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { staleInstructions } from "../src/stale-instructions.js"

let root: string
const git = (...a: string[]) =>
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8", windowsHide: true }).trim()
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}
const listed = () => git("ls-files").split(/\r?\n/).filter(Boolean)

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-stale-")))
  git("init", "-q")
  write("package.json", JSON.stringify({ name: "shop", scripts: { gate: "node gate.mjs" } }))
  write("src/pay.ts", "export const MAX_RETRIES = 3\nexport function chargeCard() {}\nexport function refundOrder() {}\n")
  git("add", ".")
  git("commit", "-q", "-m", "Payments")
  write("src/pay.ts", "export const MAX_RETRIES = 3\nexport function chargeCard() {}\n")
  git("commit", "-q", "-am", "Drop refunds for now")
  write(
    "CLAUDE.md",
    [
      "# Shop",
      "",
      "Charge with `chargeCard()` and refund with `refundOrder()`; retry up to `MAX_RETRIES` times.",
      "The code is in `src/pay.ts` (see `pay.ts`), and the old flow was in `src/gone.ts`.",
      "Run `npm run gate`, then `npm run deploy`. Settings are in the `config` and at `https://example.com/x`.",
      "",
      "```ts",
      "const x = `ghostThing`",
      "```",
    ].join("\n"),
  )
  git("add", ".")
  git("commit", "-q", "-m", "Instructions")
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe("the stale instruction detector (D-082)", () => {
  it("flags a deleted symbol, a missing path and a missing npm script, and nothing that still holds", async () => {
    const stale = await staleInstructions(root, listed())
    expect(stale.map((s) => [s.kind, s.term, s.line])).toEqual([
      ["symbol", "refundOrder()", 3],
      ["path", "src/gone.ts", 4],
      ["script", "npm run deploy", 5],
    ])
    const refund = stale[0]!
    expect(refund.file).toBe("CLAUDE.md")
    expect(refund.why).toMatch(/No code file in the project contains refundOrder/)
    expect(refund.changedIn).toMatch(/Drop refunds for now$/)
  })

  it("looks the commit up only as often as asked", async () => {
    const stale = await staleInstructions(root, listed(), { lookUpChanges: 0 })
    expect(stale[0]).not.toHaveProperty("changedIn")
  })
})
