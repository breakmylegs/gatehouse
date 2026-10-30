import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { TerminalError, TerminalManager } from "../src/terminal.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-term-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** Node stands in for PowerShell, so the tests are quick and the same on every machine. */
const node = { file: process.execPath, args: (c: string) => ["-e", c] }

function setup(opts: { killed?: boolean; auditOk?: boolean } = {}) {
  const records: Array<{ event: string; input: Record<string, unknown>; session: string }> = []
  const t = new TerminalManager({
    audit: {
      record: async (r: (typeof records)[number]) => {
        records.push(r)
        return opts.auditOk ?? true
      },
    } as never,
    killed: () => opts.killed ?? false,
    policyHash: () => "h",
    log: () => undefined,
    shell: node,
    env: { ...process.env, ANTHROPIC_API_KEY: "sk-ant-should-not-pass" },
  })
  const out: string[] = []
  const exits: Array<{ code: number | null }> = []
  t.on("output", (e: { text: string; stream: string }) => out.push(`${e.stream}:${e.text}`))
  t.on("exit", (e: { code: number | null }) => exits.push(e))
  const done = () =>
    new Promise<void>((resolve) => {
      const wait = () => (exits.length ? resolve() : setTimeout(wait, 20))
      wait()
    })
  return { t, records, out, exits, done }
}

describe("the terminal pane", () => {
  it("runs in the session's folder, streams both outputs, and reports the exit code", async () => {
    const s = setup()
    await s.t.run("s1", dir, "console.log(process.cwd()); console.error('warned'); process.exit(3)")
    await s.done()
    expect(s.out.join("")).toContain(`out:${dir}`)
    expect(s.out.join("")).toContain("err:warned")
    expect(s.exits).toEqual([expect.objectContaining({ code: 3 })])
    expect(s.t.isRunning("s1")).toBe(false)
  })

  it("records every command in the audit log first, without a folder a replay could read as Claude's", async () => {
    const s = setup()
    await s.t.run("s1", dir, "console.log(1)")
    await s.done()
    expect(s.records).toEqual([
      expect.objectContaining({
        event: "terminal_command",
        session: "s1",
        input: { command: "console.log(1)", folder: dir },
      }),
    ])
    expect(s.records[0]).not.toHaveProperty("cwd")
  })

  it("runs nothing it could not record", async () => {
    const s = setup({ auditOk: false })
    await expect(s.t.run("s1", dir, "console.log(1)")).rejects.toThrow(/audit log/)
    expect(s.t.isRunning("s1")).toBe(false)
  })

  it("refuses while the kill switch is engaged", async () => {
    const s = setup({ killed: true })
    await expect(s.t.run("s1", dir, "console.log(1)")).rejects.toThrow(TerminalError)
    expect(s.records).toEqual([])
  })

  it("runs one command at a time per session, and Stop ends it", async () => {
    const s = setup()
    await s.t.run("s1", dir, "setTimeout(() => {}, 60000)")
    await expect(s.t.run("s1", dir, "console.log(2)")).rejects.toThrow(/still running/)
    expect(s.t.stop("s1")).toBe(true)
    await s.done()
    expect(s.t.isRunning("s1")).toBe(false)
  })

  it("stops everything at once for the kill switch", async () => {
    const s = setup()
    await s.t.run("a", dir, "setTimeout(() => {}, 60000)")
    await s.t.run("b", dir, "setTimeout(() => {}, 60000)")
    s.t.stopAll()
    await new Promise<void>((resolve) => {
      const wait = () => (s.exits.length === 2 ? resolve() : setTimeout(wait, 20))
      wait()
    })
    expect(s.t.isRunning("a") || s.t.isRunning("b")).toBe(false)
  })

  it("never hands Claude's sign-in variables to your commands", async () => {
    const s = setup()
    await s.t.run("s1", dir, "console.log('key=' + (process.env.ANTHROPIC_API_KEY ?? 'none'))")
    await s.done()
    expect(s.out.join("")).toContain("key=none")
  })
})
