// A chat's memory (owner's plan, W1-08, ADR 0006): the three tools, what a chat starts knowing, every change on the
// record, and Claude Code's own auto memory off.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createCompanionSdkServer } from "../src/companion-server.js"
import { chatMemoryClient } from "../src/memory-client.js"
import { MemoryStore } from "../src/memory.js"
import { assertSafeOptions, isOnlyAutoMemoryOff } from "../src/safety.js"
import { buildStack, type Stack } from "./stack.js"
import type { HostAudit } from "../src/hostaudit.js"
import type { Options } from "@anthropic-ai/claude-agent-sdk"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-memchat-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0

/** An audit that keeps what it is given, and can be told to fail. */
function fakeAudit() {
  const records: Array<{ event: string; input?: unknown }> = []
  const audit = {
    fail: false,
    async record(r: { event: string; input?: unknown }) {
      if (audit.fail) return false
      records.push(r)
      return true
    },
  }
  return { audit: audit as unknown as HostAudit & { fail: boolean }, records }
}
const setup = (project?: string) => {
  const store = new MemoryStore(path.join(dir, `m-${++n}`), (t) =>
    t.replaceAll("AcmeCorp", "[redacted]"),
  )
  const { audit, records } = fakeAudit()
  const client = chatMemoryClient({
    store,
    audit,
    sessionId: "s1",
    cwd: "C:/chat",
    project,
    policyHash: () => "h",
  })
  return { store, audit, records, client }
}

describe("what a chat may do with memory", () => {
  it("remembers, and records it by id, scope and topic, never by what it says", async () => {
    const { client, records, store } = setup("Home")
    const r = await client.remember("Units", "Prefers metric. Works at AcmeCorp.", "everyone")
    expect(r.isError).toBeUndefined()
    expect(r.text).toMatch(/Remembered under "Units" \(id [0-9a-f]{8}\)/)
    expect(store.list({ kind: "global" })[0]).toMatchObject({
      by: "claude",
      text: "Prefers metric. Works at [redacted].",
    })
    expect(records).toHaveLength(1)
    expect(records[0]!.event).toBe("memory_written")
    expect(JSON.stringify(records[0])).not.toMatch(/metric|AcmeCorp/)
    expect(records[0]!.input).toMatchObject({ scope: "everyone", topic: "Units" })
  })

  it("keeps a project memory for the chat's own project, and refuses it outside one", async () => {
    const inProject = setup("Home")
    await inProject.client.remember("Beds", "Raised.", "project")
    expect(inProject.store.list({ kind: "project", name: "Home" })).toHaveLength(1)
    const loose = setup()
    const r = await loose.client.remember("Beds", "Raised.", "project")
    expect(r.isError).toBe(true)
    expect(loose.store.list({ kind: "global" })).toEqual([])
    expect(loose.records).toEqual([])
  })

  it("is refused, and left unwritten, when the record cannot be made", async () => {
    const { client, audit, store } = setup()
    audit.fail = true
    const r = await client.remember("t", "x", "everyone")
    expect(r).toMatchObject({ isError: true, text: expect.stringMatching(/could not be recorded/) })
    expect(store.list({ kind: "global" })).toEqual([])
  })

  it("recalls what it can see, by topic, and not another project's memory", async () => {
    const { client, store } = setup("Home")
    await store.add({ kind: "global" }, "Units", "metric", "you")
    await store.add({ kind: "project", name: "Home" }, "Beds", "raised", "you")
    await store.add({ kind: "project", name: "Other" }, "Secret", "not for this chat", "you")
    const all = client.recall().text
    expect(all).toContain("metric")
    expect(all).toContain("raised")
    expect(all).not.toContain("not for this chat")
    expect(client.recall("bed").text).toContain("raised")
    expect(client.recall("bed").text).not.toContain("metric")
    expect(client.recall("nothing here").text).toMatch(/Nothing is remembered under/)
  })

  it("forgets what it can see, on the record first, and not another project's memory", async () => {
    const { client, store, records, audit } = setup("Home")
    const mine = await store.add({ kind: "global" }, "Units", "metric", "you")
    const theirs = await store.add({ kind: "project", name: "Other" }, "Secret", "x", "you")
    expect((await client.forget(theirs.id)).isError).toBe(true)
    expect(store.find(theirs.id)).toBeTruthy()
    audit.fail = true
    expect((await client.forget(mine.id)).isError).toBe(true)
    expect(store.find(mine.id)).toBeTruthy()
    audit.fail = false
    expect((await client.forget(mine.id)).text).toMatch(/Forgotten: Units/)
    expect(store.find(mine.id)).toBeUndefined()
    expect(records.map((r) => r.event)).toEqual(["memory_forgotten"])
    expect((await client.forget("nope")).isError).toBe(true)
  })
})

describe("the tools in the Companion", () => {
  it("are offered to a session that has a memory, and only then", async () => {
    const { client: mem } = setup()
    const names = async (memory?: typeof mem) => {
      const server = createCompanionSdkServer({
        sessionId: "s",
        cwd: dir,
        host: { notify: async () => true },
        policy: () => undefined,
        redact: (v) => v,
        ...(memory ? { memory } : {}),
      })
      const [a, b] = InMemoryTransport.createLinkedPair()
      await server.instance.connect(a)
      const c = new Client({ name: "t", version: "0.0.0" })
      await c.connect(b)
      const out = (await c.listTools()).tools.map((t) => t.name).sort()
      await c.close()
      return out
    }
    expect(await names()).toEqual(["create_checkpoint", "get_policy_summary", "notify_user"])
    expect(await names(mem)).toEqual([
      "create_checkpoint",
      "forget",
      "get_policy_summary",
      "notify_user",
      "recall",
      "remember",
    ])
  })
})

describe("the one inline setting Codehouse allows", () => {
  it("is auto memory off and nothing else", () => {
    expect(isOnlyAutoMemoryOff({ autoMemoryEnabled: false })).toBe(true)
    for (const bad of [
      { autoMemoryEnabled: true },
      { autoMemoryEnabled: false, permissions: { allow: ["Bash(*)"] } },
      { permissions: { allow: ["Bash(*)"] } },
      {},
      null,
      "x",
      [],
    ])
      expect(isOnlyAutoMemoryOff(bad), JSON.stringify(bad)).toBe(false)
    const safe = (o: object) =>
      ({
        cwd: "C:/dev/x",
        permissionMode: "plan",
        env: { PATH: "x" },
        canUseTool: async () => ({ behavior: "deny", message: "x" }),
        hooks: { PreToolUse: [{ hooks: [async () => ({})] }] },
        ...o,
      }) as unknown as Options
    expect(() => assertSafeOptions(safe({ settings: { autoMemoryEnabled: false } }))).not.toThrow()
    expect(() =>
      assertSafeOptions(safe({ settings: { autoMemoryEnabled: false, hooks: {} } })),
    ).toThrow(/inline settings/)
    expect(() => assertSafeOptions(safe({ settings: { permissions: { allow: ["x"] } } }))).toThrow(
      /inline settings/,
    )
  })
})

describe("a chat started with memory", () => {
  let s: Stack
  let store: MemoryStore
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
    store = new MemoryStore(path.join(s.dir, "memory"))
    s.deps.memory = store
    s.deps.chatsDir = path.join(s.dir, "chats")
  }, 60000)
  afterAll(() => s.stop())

  it("is told what chats remember, with the use on the record by entry and not by words, and has auto memory off", async () => {
    await store.add({ kind: "global" }, "Units", "Prefers metric.", "claude")
    const chat = await s.manager.start({ cwd: "x", kind: "chat", title: "hello" })
    const o = s.sdk.queries.at(-1)?.options as {
      systemPrompt: string
      settings?: unknown
      tools: string[]
    }
    expect(o.systemPrompt).toContain("What you remember about them from earlier chats")
    expect(o.systemPrompt).toContain("- [Units] Prefers metric.")
    expect(o.systemPrompt).toContain("remember tool")
    expect(o.settings).toEqual({ autoMemoryEnabled: false })
    const used = s.records().filter((r) => r.session === chat.id && r.event === "memory_used")
    expect(used).toHaveLength(1)
    expect(JSON.stringify(used[0])).toContain("Units")
    expect(JSON.stringify(used[0])).not.toContain("metric")
    // CH-03: the chat keeps exactly what it was told, for its Memory panel.
    expect(chat.memoryGiven()).toEqual([
      { id: expect.any(String), scope: "global", topic: "Units", text: "Prefers metric." },
    ])
  })

  it("says when there is nothing remembered yet, and does not record a use of nothing", async () => {
    const empty = new MemoryStore(path.join(s.dir, "empty"))
    s.deps.memory = empty
    const chat = await s.manager.start({ cwd: "x", kind: "chat", title: "fresh" })
    const o = s.sdk.queries.at(-1)?.options as { systemPrompt: string }
    expect(o.systemPrompt).toContain("You do not remember anything about them yet.")
    expect(s.records().some((r) => r.session === chat.id && r.event === "memory_used")).toBe(false)
    expect(chat.memoryGiven()).toEqual([])
    s.deps.memory = store
  })

  it("leaves a coding session without memory or inline settings", async () => {
    await s.manager.start({ cwd: s.repo })
    const o = s.sdk.queries.at(-1)?.options as {
      systemPrompt: { append?: string }
      settings?: unknown
    }
    expect(o.settings).toBeUndefined()
    expect(o.systemPrompt.append ?? "").not.toContain("remember")
  })
})
