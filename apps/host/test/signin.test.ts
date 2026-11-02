import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { SignInFlow } from "../src/signin.js"

/** A stand-in for the sign-in process that the test controls. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn(() => {
    child.emit("exit", null)
    return true
  })
  return child
}

function setup(over: { binary?: string | undefined; timeoutMs?: number } = {}) {
  const child = fakeChild()
  const spawnFn = vi.fn(() => child)
  const onEnded = vi.fn()
  const flow = new SignInFlow({
    binary: () => ("binary" in over ? over.binary : "C:/claude.exe"),
    env: () => ({ PATH: "x" }),
    spawnFn: spawnFn as never,
    onEnded,
    ...(over.timeoutMs ? { timeoutMs: over.timeoutMs } : {}),
  })
  return { flow, child, spawnFn, onEnded }
}

describe("signing in from the app", () => {
  it("starts Anthropic's own sign-in with no input and a clean environment", () => {
    const { flow, spawnFn } = setup()
    expect(flow.start("claudeai").state).toBe("waiting")
    const [bin, args, opts] = spawnFn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: object; stdio: string[] },
    ]
    expect(bin).toBe("C:/claude.exe")
    expect(args).toEqual(["auth", "login", "--claudeai"])
    expect(opts.stdio[0]).toBe("ignore")
    expect(opts.env).toEqual({ PATH: "x" })
  })

  it("uses the single sign-on flag when asked", () => {
    const { flow, spawnFn } = setup()
    flow.start("sso")
    expect((spawnFn.mock.calls[0] as unknown as [string, string[]])[1]).toEqual([
      "auth",
      "login",
      "--sso",
    ])
  })

  it("starts only one at a time", () => {
    const { flow, spawnFn } = setup()
    flow.start("claudeai")
    flow.start("sso")
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it("keeps only the sign-in page address from the output, then finishes and asks for a re-check", async () => {
    const { flow, child, onEnded } = setup()
    flow.start("claudeai")
    child.stdout.write(
      "Opening browser to sign in\nIf it does not open visit https://claude.ai/oauth/authorize?x=1 now\n",
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(flow.status().url).toBe("https://claude.ai/oauth/authorize?x=1")
    expect(JSON.stringify(flow.status())).not.toContain("Opening browser")
    child.emit("exit", 0)
    expect(flow.status().state).toBe("finished")
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it("reports a failed sign-in and still asks for a re-check", () => {
    const { flow, child, onEnded } = setup()
    flow.start("claudeai")
    child.emit("exit", 1)
    expect(flow.status()).toMatchObject({ state: "failed" })
    expect(flow.status().message).toContain("exit code 1")
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it("says so when the program cannot be found", () => {
    const { flow, spawnFn } = setup({ binary: undefined })
    const st = flow.start("claudeai")
    expect(st.state).toBe("failed")
    expect(st.message).toContain("claude auth login")
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it("can be cancelled and then started again", () => {
    const { flow, child } = setup()
    flow.start("claudeai")
    flow.cancel()
    expect(child.kill).toHaveBeenCalled()
    expect(flow.status()).toMatchObject({ state: "failed", message: "Sign-in cancelled." })
    expect(flow.start("claudeai").state).toBe("waiting")
  })

  it("gives up after the time limit", async () => {
    const { flow, child } = setup({ timeoutMs: 20 })
    flow.start("claudeai")
    await new Promise((r) => setTimeout(r, 80))
    expect(child.kill).toHaveBeenCalled()
    expect(flow.status().message).toContain("timed out")
  })

  it("reports a process that could not start", () => {
    const { flow, child } = setup()
    flow.start("claudeai")
    child.emit("error", new Error("ENOENT"))
    expect(flow.status()).toMatchObject({ state: "failed" })
    expect(flow.status().message).toContain("ENOENT")
  })
})
