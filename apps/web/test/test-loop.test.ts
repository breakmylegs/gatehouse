// @vitest-environment jsdom
// B29: the project's tests, run and fixed until they pass, through goal mode and your rules.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runTestsUntilPass, testCommand } from "../src/lib/testLoop"
import { send, useStore } from "../src/store"

let files: Record<string, string> = {}
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) => {
    const rel = decodeURIComponent(/path=([^&]+)/.exec(url)?.[1] ?? "")
    return rel in files
      ? { ok: true, status: 200, data: { kind: "text", text: files[rel] } }
      : { ok: false, status: 403, error: "That file is not there." }
  }),
}))

const session = {
  id: "s1",
  cwd: "C:/dev/shop",
  project: "shop",
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-11-04T09:00:00Z",
}

beforeEach(() => {
  files = {}
  vi.mocked(send).mockClear()
  useStore.setState({ sessions: { s1: session }, transcripts: {} })
})

describe("the project's test command", () => {
  it("comes from the project's own files, with its package manager", async () => {
    files = { "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) }
    expect(await testCommand("s1")).toBe("npm test")
    files["pnpm-lock.yaml"] = "lockfileVersion: 9"
    expect(await testCommand("s1")).toBe("pnpm test")
    files = {
      "package.json": JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    }
    expect(await testCommand("s1")).toBeUndefined()
    files = { "pyproject.toml": "[project]" }
    expect(await testCommand("s1")).toBe("pytest")
    files = { "go.mod": "module x" }
    expect(await testCommand("s1")).toBe("go test ./...")
  })

  it("becomes the session's goal, and Claude is asked to run it until it passes", async () => {
    files = { "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) }
    await runTestsUntilPass(session)
    const sent = vi.mocked(send).mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(sent[0]).toEqual({ type: "set_goal", sessionId: "s1", check: "npm test" })
    expect(sent[1]).toMatchObject({ type: "prompt", sessionId: "s1" })
    expect(String(sent[1]?.text)).toMatch(/^Run npm test\..*GOAL MET\.$/)
  })

  it("asks nothing of Claude when no test command can be found", async () => {
    await runTestsUntilPass(session)
    expect(send).not.toHaveBeenCalled()
  })
})
