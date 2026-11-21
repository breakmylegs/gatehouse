// D-014: the paths a call would move or overwrite, read from its words before you decide; nothing runs first.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { computePayloadHash, phonePayload } from "@gatehouse/shared"
import { Broker } from "../src/broker.js"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { touchesOf } from "../src/effects.js"

let dir: string
beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-touch-")))
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n")
  fs.mkdirSync(path.join(dir, "out"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const bash = (command: string) => touchesOf("Bash", { command }, dir)
const pwsh = (command: string) => touchesOf("PowerShell", { command }, dir)

describe("what a call would move or overwrite", () => {
  it("names what mv, cp and a redirect would move or overwrite, and what is there now", () => {
    expect(bash("mv a.txt b.txt")).toEqual([
      { effect: "move", path: "a.txt", what: "file" },
      { effect: "overwrite", path: "b.txt", what: "not there" },
    ])
    expect(bash("cp -r src out")).toEqual([{ effect: "overwrite", path: "out", what: "folder" }])
    expect(bash("echo hi > a.txt && sort a.txt >sorted.txt")).toEqual([
      { effect: "overwrite", path: "a.txt", what: "file" },
      { effect: "overwrite", path: "sorted.txt", what: "not there" },
    ])
    expect(bash("make 2> err.log")).toEqual([{ effect: "overwrite", path: "err.log", what: "not there" }])
    expect(bash("echo x | tee notes.md")).toEqual([{ effect: "overwrite", path: "notes.md", what: "not there" }])
  })

  it("reads PowerShell's Move-Item, Copy-Item, Set-Content and Out-File, and cmd's move and copy", () => {
    expect(pwsh("Move-Item -Path a.txt -Destination out")).toEqual([
      { effect: "move", path: "a.txt", what: "file" },
      { effect: "overwrite", path: "out", what: "folder" },
    ])
    expect(pwsh("Copy-Item x.txt -Destination y.txt -Force")).toEqual([{ effect: "overwrite", path: "y.txt", what: "not there" }])
    expect(pwsh('Set-Content -Value "new" a.txt')).toEqual([{ effect: "overwrite", path: "a.txt", what: "file" }])
    expect(pwsh("Get-Date | Out-File -FilePath log.txt")).toEqual([{ effect: "overwrite", path: "log.txt", what: "not there" }])
    expect(bash("copy /Y a.txt b.txt")).toEqual([{ effect: "overwrite", path: "b.txt", what: "not there" }])
    expect(pwsh("Rename-Item a.txt b.txt")).toEqual([{ effect: "move", path: "a.txt", what: "file" }])
  })

  it("leaves out appends, the null device, a stream joined to another, and calls that touch nothing", () => {
    expect(bash("echo x >> log.txt; echo y 2>&1; npm test > /dev/null")).toEqual([])
    expect(bash("echo x | tee -a log.txt")).toEqual([])
    expect(pwsh("Get-Date | Out-File log.txt -Append; Get-Date > $null")).toEqual([])
    expect(bash("git status")).toEqual([])
    expect(touchesOf("Write", { file_path: "a.txt", command: "mv a.txt b.txt" }, dir)).toEqual([])
  })

  it("shows a path with a variable or a pattern as it is written, as a pattern", () => {
    expect(bash("mv *.txt $DEST")).toEqual([
      { effect: "move", path: "*.txt", what: "pattern" },
      { effect: "overwrite", path: "$DEST", what: "pattern" },
    ])
  })
})

describe("the preview on the request", () => {
  it("rides on the request while nothing has run, and the call does not run when you say no", async () => {
    let seen: Record<string, unknown> | undefined
    let atAsk: { a: boolean; b: boolean } | undefined
    const request = vi.fn(async (spec: Record<string, unknown>) => {
      seen = spec
      atAsk = { a: fs.existsSync(path.join(dir, "a.txt")), b: fs.existsSync(path.join(dir, "b.txt")) }
      return { outcome: "deny", channel: "desktop", waitedMs: 1 }
    })
    const canUse = createCanUseTool({
      sessionId: "s1",
      cwd: dir,
      project: "proj",
      approver: { evaluate: async () => ({ outcome: "escalate", ruleId: "no-rule", reason: "because", risk: 40, decidedBy: "rules", policyHash: "h" }) },
      broker: { request },
      audit: { record: async () => true },
      kill: () => false,
      policy: () => undefined,
      engine: {},
      pwsh: undefined,
      decided: new Set<string>(),
      extreme: () => false,
      effects: async () => undefined,
      log: () => undefined,
    } as unknown as CanUseDeps)
    const r = await canUse("Bash", { command: "mv a.txt b.txt" }, { toolUseID: "t1", signal: new AbortController().signal } as never)
    expect(r?.behavior).toBe("deny")
    expect(seen?.touches).toEqual([
      { effect: "move", path: "a.txt", what: "file" },
      { effect: "overwrite", path: "b.txt", what: "not there" },
    ])
    expect(atAsk).toEqual({ a: true, b: false })
    expect(fs.existsSync(path.join(dir, "a.txt"))).toBe(true)
    expect(fs.existsSync(path.join(dir, "b.txt"))).toBe(false)
  })

  it("is kept on the request the broker makes, redacted, and hashed into it", () => {
    const broker = new Broker({ phoneExpiryMs: 1000, hardTimeoutMs: 5000, redact: (v) => JSON.parse(JSON.stringify(v).replaceAll("AcmeCorp", "[redacted]")) as typeof v })
    const touches = [{ effect: "overwrite" as const, path: "AcmeCorp/b.txt", what: "file" }]
    void broker.request({
      kind: "permission",
      sessionId: "s1",
      toolUseId: "t1",
      toolName: "Bash",
      input: { command: "cp a AcmeCorp/b.txt" },
      cwd: "C:/p",
      project: "proj",
      verdict: { outcome: "escalate", ruleId: "no-rule", reason: "r", risk: 40, decidedBy: "rules", policyHash: "h" },
      touches,
      signal: new AbortController().signal,
    })
    const req = broker.list()[0]!.request
    expect(req.touches).toEqual([{ effect: "overwrite", path: "[redacted]/b.txt", what: "file" }])
    broker.cancelAll()
  })

  it("is in the phone's sealed payload only when there is one, so other requests hash as before", () => {
    const base = {
      id: "r1",
      nonce: "n",
      kind: "permission" as const,
      sessionId: "s1",
      toolUseId: "t1",
      toolName: "Bash",
      input: { command: "git status" },
      cwd: "C:/p",
      project: "proj",
      verdict: { outcome: "escalate" as const, ruleId: "no-rule", reason: "r", risk: 40, decidedBy: "rules" as const, policyHash: "h" },
      createdAt: "2026-11-21T00:00:00.000Z",
      expiresAt: "2026-11-21T00:10:00.000Z",
    }
    expect(computePayloadHash({ ...base, touches: [] })).toBe(computePayloadHash(base))
    const touches = [{ effect: "overwrite" as const, path: "b.txt", what: "file" }]
    expect(phonePayload({ ...base, touches })).toMatchObject({ touches })
    expect(computePayloadHash({ ...base, touches })).not.toBe(computePayloadHash(base))
  })
})
