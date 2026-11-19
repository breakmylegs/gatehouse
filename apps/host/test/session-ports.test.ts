// T-113: the ports a session's processes listen on: only those of the process Codehouse started it in and everything
// below it, one a port, lowest first; none when it has no such process.
import { describe, expect, it } from "vitest"
import { portsUnder, sessionPorts } from "../src/session-ports.js"

const procs = [
  { pid: 100, parent: 1, name: "Codehouse-Limits.exe" },
  { pid: 101, parent: 100, name: "claude.exe" },
  { pid: 102, parent: 101, name: "pwsh.exe" },
  { pid: 103, parent: 102, name: "node.exe" },
  { pid: 200, parent: 1, name: "Codehouse-Limits.exe" },
  { pid: 201, parent: 200, name: "node.exe" },
]
const sockets = [
  { port: 5173, pid: 103, address: "::1" },
  { port: 5173, pid: 103, address: "127.0.0.1" },
  { port: 3000, pid: 103, address: "0.0.0.0" },
  { port: 8080, pid: 201, address: "127.0.0.1" },
  { port: 445, pid: 4, address: "0.0.0.0" },
]

describe("the ports a session's processes hold (T-113)", () => {
  it("lists only those of the session's own process tree, one a port, lowest first", () => {
    expect(portsUnder(100, procs, sockets)).toEqual([
      { port: 3000, pid: 103, process: "node.exe", address: "0.0.0.0" },
      { port: 5173, pid: 103, process: "node.exe", address: "::1" },
    ])
    expect(portsUnder(200, procs, sockets).map((p) => p.port)).toEqual([8080])
    expect(portsUnder(999, procs, sockets)).toEqual([])
  })

  it("has none for a session with no process of its own, or away from Windows", async () => {
    expect(await sessionPorts(undefined)).toEqual([])
    expect(await sessionPorts(100, "darwin")).toEqual([])
  })
})
