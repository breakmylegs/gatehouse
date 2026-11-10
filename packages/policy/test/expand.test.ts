// D-013, effect-complete approval cards: what a shell call would also run is expanded, judged, and carried on the
// verdict for the desktop and the phone.
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { phonePayload } from "@gatehouse/shared"
import { expandEffects } from "../src/expand.js"
import { PwshWorker } from "../src/pwsh.js"
import { fwd, makeEngine, makeFixture, type Fixture } from "./helpers.js"

const fx: Fixture = makeFixture()
const pwsh = new PwshWorker()
let engine: ReturnType<typeof makeEngine>["engine"]
const realProfile = process.env.USERPROFILE

beforeAll(async () => {
  process.env.USERPROFILE = fx.root
  await pwsh.start()
  engine = makeEngine(fx, pwsh).engine
}, 60000)
afterAll(() => {
  process.env.USERPROFILE = realProfile
  pwsh.close()
  fx.dispose()
})

function project(name: string, files: Record<string, string>): string {
  const dir = path.join(fx.ws, "exp", name)
  for (const [f, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.writeFileSync(path.join(dir, f), content)
  }
  return dir
}

describe("effect-complete approval cards (D-013)", () => {
  it("effects_expand: npm test whose script runs curl asks, and the line is on the verdict for the card", async () => {
    const cwd = project("curl", { "package.json": JSON.stringify({ scripts: { test: "curl -s https://x.example/r" } }) })
    const v = await engine.evaluate({ toolName: "Bash", input: { command: "npm test" } }, { cwd: fwd(cwd) })
    expect(v).toMatchObject({ outcome: "escalate", ruleId: "network" })
    expect(v.reason).toContain('npm script test runs "curl -s https://x.example/r"')
    expect(v.expanded).toEqual([{ from: "npm script test", line: "curl -s https://x.example/r" }])
    // The phone is shown it too, sealed with the rest.
    const payload = phonePayload({
      id: "r1",
      nonce: "n",
      kind: "permission",
      sessionId: "s",
      toolUseId: "t",
      toolName: "Bash",
      input: { command: "npm test" },
      cwd,
      project: "p",
      verdict: v,
      createdAt: "2026-11-10T00:00:00Z",
      expiresAt: "2026-11-10T00:05:00Z",
    } as never)
    expect(payload.verdict).toMatchObject({ expanded: [{ from: "npm script test", line: "curl -s https://x.example/r" }] })
  })

  it("effects_expand: a git commit whose pre-commit hook runs a denied command is denied", async () => {
    const cwd = project("hook", {
      ".git/config": "[core]\n",
      ".git/hooks/pre-commit": "#!/bin/sh\nnpx lint-staged\ngit push --force origin main\n",
    })
    const v = await engine.evaluate({ toolName: "Bash", input: { command: "git commit -m wip" } }, { cwd: fwd(cwd) })
    expect(v).toMatchObject({ outcome: "deny", ruleId: "destructive-shell" })
    expect(v.expanded?.map((e) => e.line)).toContain("git push --force origin main")
  })

  it("adds nothing to a call that runs nothing more, so its request hashes as it always did", async () => {
    const v = await engine.evaluate({ toolName: "Bash", input: { command: "git status" } }, { cwd: fwd(fx.ws) })
    expect(v.expanded).toBeUndefined()
    const p = phonePayload({ verdict: v } as never)
    expect(Object.keys(p.verdict)).not.toContain("expanded")
  })

  it("reads the PowerShell profile for a PowerShell call, unless it is told not to load one", () => {
    const docs = path.join(fx.root, "Documents", "PowerShell")
    fs.mkdirSync(docs, { recursive: true })
    fs.writeFileSync(path.join(docs, "Microsoft.PowerShell_profile.ps1"), "# mine\nSet-Alias g git\nInvoke-RestMethod https://x.example\n")
    try {
      const e = expandEffects("Get-ChildItem", "pwsh", fx.ws)
      expect(e.lines.map((l) => l.line)).toEqual(["Set-Alias g git", "Invoke-RestMethod https://x.example"])
      expect(e.lines.every((l) => l.shell === "pwsh")).toBe(true)
      expect(expandEffects("pwsh -NoProfile -c dir", "pwsh", fx.ws, [{ text: "pwsh -NoProfile -c dir" } as never]).lines).toEqual([])
      // Bash calls do not load it.
      expect(expandEffects("ls", "bash", fx.ws).lines).toEqual([])
    } finally {
      fs.rmSync(path.join(fx.root, "Documents"), { recursive: true, force: true })
    }
  })

  it("follows scripts that call scripts, stops at a loop, and never runs anything", () => {
    const cwd = project("loop", {
      "package.json": JSON.stringify({ scripts: { a: "npm run b", b: "npm run a && touch ran.txt" } }),
    })
    const e = expandEffects("npm run a", "bash", cwd)
    expect(e.lines.map((l) => l.line)).toEqual(["npm run b", "npm run a && touch ran.txt"])
    expect(fs.existsSync(path.join(cwd, "ran.txt"))).toBe(false)
  })
})
