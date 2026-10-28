import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { afterAll, describe, expect, it, vi } from "vitest"
import { LocalRelay } from "../src/relay/local.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-local-relay-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    stdin: PassThrough
    exitCode: number | null
    signalCode: string | null
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn(() => {
    child.exitCode = 0
    child.emit("exit", 0)
    return true
  })
  return child
}

function setup(opts: { linked?: boolean; ready?: boolean } = {}) {
  const child = fakeChild()
  const spawnFn = vi.fn(() => {
    // The real Relay writes its one-time token, then says it is listening.
    fs.writeFileSync(path.join(dir, "enrol-token.txt"), "one-time-token\n")
    if (opts.ready !== false)
      setTimeout(
        () => child.stdout.write("[relay] listening on 127.0.0.1:8099 for https://x.ts.net\n"),
        5,
      )
    else setTimeout(() => child.emit("exit", 1), 5)
    return child
  })
  const enrol = vi.fn(async () => undefined)
  const relay = new LocalRelay({
    command: "node",
    args: ["relay.js"],
    cwd: dir,
    dataDir: dir,
    log: () => undefined,
    enrol,
    linked: () => opts.linked === true,
    spawnFn: spawnFn as never,
    readyTimeoutMs: 2000,
  })
  return { relay, child, spawnFn, enrol }
}

describe("the Relay run inside JCVC", () => {
  it("starts the Relay on loopback for the https address, and links JCVC with its one-time token", async () => {
    const t = setup()
    const st = await t.relay.start("https://x.ts.net/anything", 8099)
    expect(st).toMatchObject({ state: "running", port: 8099, publicUrl: "https://x.ts.net" })
    const [, args, options] = t.spawnFn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string> },
    ]
    expect(args).toEqual([
      "relay.js",
      "--public-url",
      "https://x.ts.net",
      "--port",
      "8099",
      "--data-dir",
      dir,
    ])
    expect(options.env.RELAY_HOST).toBe("127.0.0.1")
    expect(t.enrol).toHaveBeenCalledWith("http://127.0.0.1:8099", "one-time-token")
    await t.relay.stop()
    expect(t.child.kill).toHaveBeenCalled()
    expect(t.relay.status().state).toBe("off")
  })

  it("does not enrol again when JCVC is already linked", async () => {
    const t = setup({ linked: true })
    expect((await t.relay.start("https://x.ts.net", 8099)).state).toBe("running")
    expect(t.enrol).not.toHaveBeenCalled()
    await t.relay.stop()
  })

  it("refuses an address the phone cannot use", async () => {
    const t = setup()
    for (const bad of ["http://x.ts.net", "not an address"]) {
      const st = await t.relay.start(bad, 8099)
      expect(st.state, bad).toBe("failed")
    }
    expect(t.spawnFn).not.toHaveBeenCalled()
  })

  it("reports a Relay that stops before it is ready, and enrols nothing", async () => {
    const t = setup({ ready: false })
    const st = await t.relay.start("https://x.ts.net", 8099)
    expect(st.state).toBe("failed")
    expect(st.message).toMatch(/stopped/)
    expect(t.enrol).not.toHaveBeenCalled()
  })
})
