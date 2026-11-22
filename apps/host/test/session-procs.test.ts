// E-029: what a session left running, with its ports; a server about to start on a port in use goes to a person first;
// nothing is stopped without confirmation, and only what the session started.
import { createServer } from "node:net"
import { spawn } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { PORT_CLASH_RULE, portHolder, processesUnder, serverPort, stopUnder, windowsSnapshot, type ProcRow } from "../src/session-procs.js"

const procs: ProcRow[] = [
  { pid: 10, parent: 1, name: "Codehouse-Limits.exe" },
  { pid: 11, parent: 10, name: "claude.exe" },
  { pid: 12, parent: 11, name: "node.exe", started: "2026-11-22T09:00:00.000Z" },
  { pid: 13, parent: 12, name: "esbuild.exe" },
  { pid: 99, parent: 1, name: "node.exe" },
]

describe("port and process tracking", () => {
  it("lists what the session started, with ports, and never its own processes", () => {
    expect(processesUnder(10, procs, [{ port: 5173, pid: 12 }, { port: 3000, pid: 99 }])).toEqual([
      { pid: 12, name: "node.exe", started: "2026-11-22T09:00:00.000Z", ports: [5173] },
      { pid: 13, name: "esbuild.exe", ports: [] },
    ])
  })

  it("knows the port a command would start a server on", () => {
    expect(serverPort("npx vite --port 5180")).toBe(5180)
    expect(serverPort("PORT=4000 npm start")).toBe(4000)
    expect(serverPort("npx vite")).toBe(5173)
    expect(serverPort("npx next dev")).toBe(3000)
    expect(serverPort("python -m http.server")).toBe(8000)
    expect(serverPort("npm test")).toBeUndefined()
  })

  it("sends a server about to start on a port in use to a person first, and lets one on a free port run", async () => {
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const holders: Record<number, string> = { 5173: "node.exe (12)" }
    const canUse = createCanUseTool({
      sessionId: "s1", cwd: "C:/p", project: "shop",
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "dev-server", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      broker: { request }, audit: { record: async () => true }, kill: () => false, policy: () => undefined, engine: {}, pwsh: undefined,
      decided: new Set<string>(), extreme: () => false, effects: async () => undefined, log: () => undefined,
      portHolder: async (port: number) => holders[port],
    } as unknown as CanUseDeps)
    const call = (command: string) => canUse("Bash", { command }, { toolUseID: "t", signal: new AbortController().signal } as never)
    expect((await call("npx vite"))?.behavior).toBe("deny")
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ ruleId: PORT_CLASH_RULE, reason: expect.stringMatching(/port 5173, and node\.exe \(12\) already listens/) }) }))
    expect((await call("npx vite --port 5199"))?.behavior).toBe("allow")
  })

  it("stops nothing without confirmation, and nothing the session did not start", async () => {
    const kill = vi.fn(async () => undefined)
    const snap = async () => ({ procs, listening: [] })
    expect(await stopUnder(10, 12, false, snap, kill)).toMatchObject({ stopped: false, why: expect.stringMatching(/confirmation/) })
    expect(await stopUnder(10, 99, true, snap, kill)).toMatchObject({ stopped: false, why: expect.stringMatching(/not one this session started/) })
    expect(await stopUnder(10, 11, true, snap, kill)).toMatchObject({ stopped: false })
    expect(kill).not.toHaveBeenCalled()
    expect(await stopUnder(10, 12, true, snap, kill)).toEqual({ stopped: true })
    expect(kill).toHaveBeenCalledWith(12)
  })

  it.skipIf(process.platform !== "win32")("finds a fixture dev server under its parent, with its port", { timeout: 60_000 }, async () => {
    const server = spawn(process.execPath, ["-e", "require('http').createServer((q,r)=>r.end('ok')).listen(0,'127.0.0.1',function(){console.log(this.address().port)})"], { stdio: ["ignore", "pipe", "ignore"] })
    try {
      const port = await new Promise<number>((resolve) => server.stdout!.once("data", (d: Buffer) => resolve(Number(String(d).trim()))))
      const { procs: all, listening } = await windowsSnapshot()
      const found = processesUnder(process.pid, all, listening).find((p) => p.pid === server.pid)
      expect(found?.ports).toContain(port)
      expect(await portHolder(port, windowsSnapshot)).toMatch(/node(\.exe)? \(\d+\)/)
      const free = createServer()
      await new Promise<void>((r) => free.listen(0, "127.0.0.1", () => r()))
      const freePort = (free.address() as { port: number }).port
      await new Promise<void>((r) => free.close(() => r()))
      expect(await portHolder(freePort, windowsSnapshot)).toBeUndefined()
    } finally {
      server.kill()
    }
  })
})
