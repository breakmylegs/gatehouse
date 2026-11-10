// D-058, the secret commit block on a real session: a commit that stages a test AWS key is denied, in Extreme approval
// too, and the audit, the Host's log and the transcript hold no part of the key. The key is put together at run time.
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SECRET_IN_COMMIT_RULE } from "../src/commit-scan.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

const AWS = ["AK", "IA", "W7QJ2MZK4TNB", "8RYX"].join("")

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
}, 60000)
afterAll(() => s.stop())

/** Every file under a folder, as text. */
const allText = (dir: string): string =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => fs.readFileSync(path.join(d.parentPath, d.name), "utf8"))
        .join("\n")
    : ""

describe("the secret commit block on a session (D-058)", () => {
  it("secret_no_leak: denies the commit in Extreme approval, and no record, log or transcript holds the key", async () => {
    fs.writeFileSync(path.join(s.repo, "src", "cloud.ts"), `export const region = "eu-west-2"\nexport const key = "${AWS}"\n`)
    s.git("add", "src/cloud.ts")
    const results: ToolCallResult[] = []
    s.sdk.turn = async (api, text) => {
      if (text !== "commit") return api.say("QUEUE EMPTY")
      results.push(await api.callTool("Bash", { command: 'git commit -m "cloud config"' }))
      // You commit it yourself, in your own terminal: yours, not scanned; a session's push does not send it on.
      s.git("commit", "-q", "-m", "yours")
      results.push(await api.callTool("Bash", { command: "git push origin HEAD" }))
      api.say("done")
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    const events: string[] = []
    session.on("event", (e) => events.push(JSON.stringify(e)))
    session.prompt("commit")
    await expect.poll(() => results.length, { timeout: 20_000 }).toBe(2)
    // Both refused by the floor, the reason naming the file and line.
    for (const r of results) expect(r.executed).toBe(false)
    const denies = s.records().filter((r) => r.event === "floor_deny" && r.session === session.id)
    expect(denies).toHaveLength(2)
    expect(JSON.stringify(denies)).toContain(SECRET_IN_COMMIT_RULE)
    expect(JSON.stringify(denies)).toContain("src/cloud.ts, line 2")
    // Not committed.
    expect(s.git("log", "--format=%s")).not.toContain("cloud config")
    // No part of the key anywhere Codehouse writes: the audit, the Host's log, the transcript, the session's state.
    const elsewhere = [
      allText(s.auditDir),
      JSON.stringify(s.records()),
      s.logs.join("\n"),
      events.join("\n"),
      JSON.stringify(results),
      JSON.stringify(session.info()),
      fs.existsSync(s.statePath) ? fs.readFileSync(s.statePath, "utf8") : "",
    ].join("\n")
    for (let i = 4; i + 6 <= AWS.length; i++) expect(elsewhere).not.toContain(AWS.slice(i, i + 6))
    await session.close()
  })
})
