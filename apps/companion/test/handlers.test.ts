import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { loadPolicy, redact, type Policy } from "@gatehouse/policy"
import {
  CompanionHandlers,
  NOTIFY_INTERVAL_MS,
  NOTIFY_MAX_CHARS,
  type HostClient,
  type NotifyMessage,
} from "../src/index.js"
import { SUMMARY_MAX_CHARS, summarisePolicy } from "../src/summary.js"
import { SEED_RULES } from "../../../packages/policy/test/helpers.js"

let root: string
let n = 0
let policy: Policy

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-companion-"))
  policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: ["C:/dev"] })
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

class FakeHost implements HostClient {
  sent: NotifyMessage[] = []
  accept = true
  delayMs = 0
  async notify(m: NotifyMessage): Promise<boolean> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    if (this.accept) this.sent.push(m)
    return this.accept
  }
}

function make(over: Partial<ConstructorParameters<typeof CompanionHandlers>[0]> = {}) {
  const host = new FakeHost()
  let clock = 1_000_000
  const handlers = new CompanionHandlers({
    sessionId: "sess-1",
    cwd: "C:/dev",
    host,
    policy: () => policy,
    redact: (v) => redact(v, { terms: ["AcmeCorp"] }),
    now: () => clock,
    ...over,
  })
  return { host, handlers, advance: (ms: number) => (clock += ms) }
}

describe("notify_user", () => {
  it("sends a short message, redacted, with the session id", async () => {
    const { host, handlers } = make()
    const secret = "ghp_" + "Ab1Cd2Ef3G".repeat(4)
    const r = await handlers.notifyUser(`Done with AcmeCorp build, token ${secret}`)
    expect(r).toEqual({ text: "Sent." })
    expect(host.sent).toHaveLength(1)
    expect(host.sent[0]?.sessionId).toBe("sess-1")
    expect(host.sent[0]?.text).not.toContain(secret)
    expect(host.sent[0]?.text).not.toContain("AcmeCorp")
    expect(host.sent[0]?.text.length).toBeLessThanOrEqual(NOTIFY_MAX_CHARS)
  })

  it("allows 140 characters and refuses 141, and refuses an empty message", async () => {
    const { handlers, host } = make()
    expect((await handlers.notifyUser("x".repeat(141))).isError).toBe(true)
    expect((await handlers.notifyUser("   \n\t ")).isError).toBe(true)
    expect(host.sent).toHaveLength(0)
    expect((await handlers.notifyUser("x".repeat(140))).text).toBe("Sent.")
  })

  it("collapses newlines and control characters into spaces", async () => {
    const { handlers, host } = make()
    await handlers.notifyUser("line one\nline two\u0007  end")
    expect(host.sent[0]?.text).toBe("line one line two end")
  })

  it("allows one a minute per session, and tells the agent when to retry", async () => {
    const { handlers, host, advance } = make()
    expect((await handlers.notifyUser("first")).text).toBe("Sent.")
    advance(10_000)
    const second = await handlers.notifyUser("second")
    expect(second.text).toMatch(/only one notification a minute.*50 seconds/)
    expect(host.sent).toHaveLength(1)
    advance(NOTIFY_INTERVAL_MS)
    expect((await handlers.notifyUser("third")).text).toBe("Sent.")
    expect(host.sent.map((m) => m.text)).toEqual(["first", "third"])
  })

  it("lets only one of two simultaneous calls through", async () => {
    const { handlers, host } = make()
    host.delayMs = 30
    const results = await Promise.all([handlers.notifyUser("a"), handlers.notifyUser("b")])
    const texts = results.map((r) => r.text)
    expect(texts.filter((t) => t === "Sent.")).toHaveLength(1)
    expect(texts.filter((t) => t.includes("only one notification"))).toHaveLength(1)
    expect(host.sent).toHaveLength(1)
  })

  it("reports an unreachable host without throwing, and does not use up the minute", async () => {
    const { handlers, host } = make()
    host.accept = false
    expect((await handlers.notifyUser("hello")).text).toContain("could not be reached")
    host.accept = true
    expect((await handlers.notifyUser("hello again")).text).toBe("Sent.")
  })
})

describe("create_checkpoint", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
  function repo(): string {
    const dir = path.join(root, `repo${n++}`)
    fs.mkdirSync(dir)
    git(dir, "init", "-q")
    fs.writeFileSync(path.join(dir, "a.txt"), "one\n")
    git(dir, "add", ".")
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    return dir
  }

  it("saves a checkpoint, leaves secrets out of it and does not touch the working tree", async () => {
    const dir = repo()
    fs.writeFileSync(path.join(dir, "a.txt"), "two\n")
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=1\n")
    fs.writeFileSync(path.join(dir, "new.txt"), "n\n")
    const before = git(dir, "status", "--porcelain")
    const { handlers } = make({ cwd: dir })
    const r = await handlers.createCheckpoint("before AcmeCorp refactor")
    expect(r.isError).toBeUndefined()
    const ref = /as (refs\/gatehouse\/checkpoints\/[^ ]+)\./.exec(r.text)?.[1] as string
    expect(ref).toMatch(/^refs\/gatehouse\/checkpoints\/sess-1\//)
    const files = git(dir, "ls-tree", "-r", "--name-only", ref).split("\n")
    expect(files).toEqual(expect.arrayContaining(["a.txt", "new.txt"]))
    expect(files).not.toContain(".env")
    expect(git(dir, "status", "--porcelain")).toBe(before)
    expect(git(dir, "log", "-1", "--format=%s", ref)).not.toContain("AcmeCorp")
  })

  it("explains itself outside a git repository and without a policy", async () => {
    const plain = fs.mkdtempSync(path.join(root, "plain-"))
    const outside = await make({ cwd: plain }).handlers.createCheckpoint("x")
    expect(outside.isError).toBe(true)
    expect(outside.text).toContain("No checkpoint")
    const noPolicy = await make({ policy: () => undefined }).handlers.createCheckpoint("x")
    expect(noPolicy).toMatchObject({ isError: true })
    expect(noPolicy.text).toContain("no policy is loaded")
  })
})

describe("get_policy_summary", () => {
  it("lists what is pre-approved and what is never available, in a fixed shape", () => {
    const { handlers } = make()
    const text = handlers.getPolicySummary().text
    expect(text).toContain(`JCVC policy ${policy.hash.slice(0, 12)}`)
    expect(text).toContain("Read, Glob, Grep inside the workspace")
    expect(text).toContain("git status*")
    expect(text).toContain("src/**")
    expect(text).toContain("notify_user")
    expect(text).toContain("secrets files")
    expect(text).toContain(
      "Variables, substitutions, heredocs and output redirection always need approval",
    )
    expect(text.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS)
  })

  it("takes no arguments, so it cannot be used to probe a command", () => {
    const { handlers } = make()
    expect(handlers.getPolicySummary.length).toBe(0)
  })

  it("says so when no policy is loaded and notes a project overlay", () => {
    expect(summarisePolicy(undefined, "C:/dev")).toContain("No policy is loaded")
    const withOverlay: Policy = {
      ...policy,
      overlays: { dev: { version: 1, removeAllow: ["safe-shell"] } },
    }
    const text = summarisePolicy(withOverlay, "C:/dev")
    expect(text).not.toContain("git status*")
    expect(text).toContain("extra restrictions")
  })

  it("is cut to the size limit", () => {
    const big: Policy = {
      ...policy,
      rules: { ...policy.rules, allow: [{ id: "huge", commands: ["x".repeat(3000)] }] },
    }
    const text = summarisePolicy(big, "C:/dev")
    expect(text.length).toBe(SUMMARY_MAX_CHARS)
    expect(text.endsWith("...")).toBe(true)
  })
})
