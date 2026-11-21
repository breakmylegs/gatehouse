// D-094: each session's remote endpoints, from its own processes, against what it may reach; flagged outside it,
// stopped in strict mode; the report signed and checkable.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { classify, descendants, EgressMonitor, inRange, signReport, verifyReport, type ConnRow, type ProcRow } from "../src/egress.js"
import { KnowledgeKey } from "../src/knowledge-pack.js"

const procs: ProcRow[] = [
  { pid: 10, parent: 1, name: "Codehouse-Limits.exe" },
  { pid: 11, parent: 10, name: "claude.exe" },
  { pid: 12, parent: 11, name: "node.exe" },
  { pid: 20, parent: 1, name: "Codehouse-Limits.exe" },
  { pid: 21, parent: 20, name: "claude.exe" },
  { pid: 99, parent: 1, name: "chrome.exe" },
]
const conns: ConnRow[] = [
  { pid: 11, remote: "160.79.104.10", port: 443, proto: "tcp" },
  { pid: 12, remote: "203.0.113.7", port: 443, proto: "tcp" },
  { pid: 12, remote: "127.0.0.1", port: 11434, proto: "tcp" },
  { pid: 21, remote: "198.51.100.5", port: 443, proto: "tcp" },
  { pid: 21, remote: "127.0.0.1", port: 11434, proto: "tcp" },
  { pid: 99, remote: "203.0.113.99", port: 443, proto: "tcp" },
]
let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-egress-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the egress report", () => {
  it("finds a session's processes and checks addresses against its list", () => {
    expect([...descendants(10, procs)].sort()).toEqual([10, 11, 12])
    expect(inRange("160.79.105.255", "160.79.104.0/23")).toBe(true)
    expect(inRange("160.79.106.1", "160.79.104.0/23")).toBe(false)
    expect(inRange("2607:6bc0::1", "2607:6bc0::/48")).toBe(true)
    const resolved = new Map([["198.51.100.5", "registry.npmjs.org"]])
    expect(classify("127.0.0.1", { local: true, resolved })).toEqual({ allowed: true, why: "this computer" })
    expect(classify("160.79.104.10", { local: true, resolved })).toEqual({ allowed: false })
    expect(classify("160.79.104.10", { local: false, resolved })).toEqual({ allowed: true, why: "Anthropic" })
    expect(classify("198.51.100.5", { local: false, resolved })).toEqual({ allowed: true, why: "registry.npmjs.org" })
    expect(classify("203.0.113.7", { local: false, resolved })).toEqual({ allowed: false })
  })

  it("lists each session's endpoints, flags what is outside its list, and stops it only in strict mode", async () => {
    const flagged: Array<[string, string, boolean]> = []
    let strict = false
    const m = new EgressMonitor({
      sessions: () => [
        { id: "claude-session", rootPid: 10, local: false },
        { id: "local-model", rootPid: 20, local: true },
        { id: "not-started", rootPid: undefined, local: false },
      ],
      sampler: async () => ({ procs, conns }),
      extraHosts: () => [],
      strict: () => strict,
      onFlagged: (s, e, stop) => flagged.push([s, e.remote, stop]),
      lookup: async () => [],
      now: () => new Date("2026-11-21T10:00:00Z"),
    })
    await m.sample()
    expect(m.report("claude-session")!.endpoints.map((e) => [e.remote, e.allowed, e.process])).toEqual([
      ["160.79.104.10", true, "claude.exe"],
      ["203.0.113.7", false, "node.exe"],
      ["127.0.0.1", true, "node.exe"],
    ])
    expect(m.report("claude-session")!.flagged).toBe(1)
    expect(m.report("local-model")!.endpoints.map((e) => [e.remote, e.allowed])).toEqual([
      ["198.51.100.5", false],
      ["127.0.0.1", true],
    ])
    expect(flagged).toEqual([
      ["claude-session", "203.0.113.7", false],
      ["local-model", "198.51.100.5", false],
    ])
    expect(m.report("not-started")).toBeUndefined()
    // Seen again: not flagged twice. A new endpoint in strict mode stops the session.
    strict = true
    conns.push({ pid: 12, remote: "192.0.2.44", port: 8443, proto: "tcp" })
    await m.sample()
    expect(flagged.at(-1)).toEqual(["claude-session", "192.0.2.44", true])
    expect(flagged).toHaveLength(3)
  })

  it("signs a report so it can be checked, and a changed report fails the check", async () => {
    const key = new KnowledgeKey(path.join(dir, "k.json"), { protect: async (x) => x, unprotect: async (x) => x })
    const signed = await signReport({ v: 1, session: "s", from: "a", to: "b", endpoints: [], flagged: 0 }, (b) => key.signBytes(b))
    expect(verifyReport(signed)).toBe(true)
    const changed = { ...signed, report: Buffer.from(JSON.stringify({ v: 1, session: "s", from: "a", to: "b", endpoints: [], flagged: 5 })).toString("base64") }
    expect(verifyReport(changed)).toBe(false)
  })
})
