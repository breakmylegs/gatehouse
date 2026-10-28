import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { redactString } from "@gatehouse/policy"
import { Broker } from "../src/broker.js"
import { SlackChannel, SlackSecretStore, type SlackSettings } from "../src/push/slack.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-slack-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const secrets = { botToken: "xoxb-1111-2222-abcdefghijklmnop", appToken: "xapp-1-A111-2222-abcdef" }

function setup(opts: { risk?: number; command?: string } = {}) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = []
  const refused: string[] = []
  const sent: string[] = []
  const settings: SlackSettings = {
    enabled: true,
    channel: "C0123ABCD",
    userId: "U0OWNER1",
    maxRisk: 69,
  }
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = String(url).split("/api/")[1] ?? ""
    calls.push({ method, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> })
    const reply =
      method === "apps.connections.open"
        ? { ok: true, url: "wss://wss.slack.example/link" }
        : method === "chat.postMessage"
          ? { ok: true, channel: "C0123ABCD", ts: "1700000000.0001" }
          : { ok: true }
    return new Response(JSON.stringify(reply), { status: 200 })
  }) as typeof fetch
  const socket = {
    send: (d: string) => void sent.push(d),
    close: () => undefined,
    onmessage: null as ((ev: { data: unknown }) => void) | null,
    onclose: null as (() => void) | null,
    onerror: null as (() => void) | null,
  }
  const broker = new Broker({ phoneExpiryMs: 60_000, hardTimeoutMs: 600_000, redact: (v) => v })
  const channel = new SlackChannel({
    broker,
    settings: () => settings,
    secrets: async () => secrets,
    redact: (t) => redactString(t, { terms: ["AcmeCorp"] }),
    expiryMs: () => 60_000,
    onRefused: (r) => refused.push(r),
    log: () => undefined,
    fetchImpl,
    socketFactory: () => socket,
  })
  const decision = broker.request({
    kind: "permission",
    sessionId: "s1",
    toolUseId: "t1",
    toolName: "Bash",
    input: { command: opts.command ?? "npm install left-pad" },
    cwd: "C:/dev/app",
    project: "app",
    verdict: {
      outcome: "escalate",
      ruleId: "package-install",
      reason: "x",
      risk: opts.risk ?? 60,
      decidedBy: "rules",
      policyHash: "h",
    },
  })
  const view = broker.list()[0]!
  return { broker, channel, calls, refused, sent, socket, view, decision, settings }
}

type Button = { action_id: string; value: string }
const buttons = (body: Record<string, unknown>): Button[] =>
  (body.blocks as Array<{ type: string; elements?: Button[] }>).find((b) => b.type === "actions")
    ?.elements ?? []

const tap = (userId: string, b: Button, envelope = "env-1") =>
  JSON.stringify({
    envelope_id: envelope,
    type: "interactive",
    payload: {
      type: "block_actions",
      user: { id: userId },
      actions: [{ action_id: b.action_id, value: b.value }],
    },
  })

describe("Slack push", () => {
  it("posts a redacted summary with Approve and Deny buttons", async () => {
    const t = setup({ command: "deploy --token sk-ant-abcdefghijklmnop1234 to acmecorp" })
    await t.channel.notify(t.view)
    const post = t.calls.find((c) => c.method === "chat.postMessage")!
    expect(post.body.channel).toBe("C0123ABCD")
    const text = JSON.stringify(post.body)
    expect(text).not.toContain("sk-ant-abcdefghijklmnop1234")
    expect(text).not.toMatch(/acmecorp/i)
    expect(buttons(post.body).map((b) => b.action_id)).toEqual(["jcvc_allow", "jcvc_deny"])
  })

  it("acknowledges every envelope, accepts your tap once, and refuses anyone else's", async () => {
    const t = setup()
    await t.channel.start()
    await new Promise((r) => setTimeout(r, 20))
    await t.channel.notify(t.view)
    const [allow] = buttons(t.calls.find((c) => c.method === "chat.postMessage")!.body)
    t.channel.handleEnvelope(tap("U0SOMEONE", allow!, "env-a"))
    expect(t.sent).toContain(JSON.stringify({ envelope_id: "env-a" }))
    expect(t.refused[0]).toMatch(/someone other than you/)
    expect(t.broker.list()).toHaveLength(1)
    t.channel.handleEnvelope(tap("U0OWNER1", allow!, "env-b"))
    expect((await t.decision).outcome).toBe("allow")
    expect((await t.decision).channel).toBe("push")
    t.channel.handleEnvelope(tap("U0OWNER1", allow!, "env-c"))
    expect(t.refused.at(-1)).toMatch(/used already/)
    t.channel.stop()
  })

  it("never offers Approve above the limit", async () => {
    const t = setup({ risk: 80 })
    await t.channel.notify(t.view)
    const post = t.calls.find((c) => c.method === "chat.postMessage")!
    expect(buttons(post.body).map((b) => b.action_id)).toEqual(["jcvc_deny"])
  })

  it("refuses a forged button value", async () => {
    const t = setup()
    await t.channel.notify(t.view)
    t.channel.handleEnvelope(
      tap("U0OWNER1", {
        action_id: "jcvc_allow",
        value: `allow ${t.view.request.id} ${"A".repeat(32)}`,
      }),
    )
    expect(t.refused.at(-1)).toMatch(/wrong allow code/)
    expect(t.broker.list()).toHaveLength(1)
  })

  it("keeps the tokens sealed on disk, never in readable form", async () => {
    const reverse = {
      protect: async (b: Uint8Array) => Uint8Array.from(b).reverse(),
      unprotect: async (b: Uint8Array) => Uint8Array.from(b).reverse(),
    }
    const store = new SlackSecretStore(path.join(dir, "slack.sealed"), reverse)
    await store.save(secrets)
    const raw = fs.readFileSync(path.join(dir, "slack.sealed"), "utf8")
    expect(raw).not.toContain("xoxb-")
    expect(await store.load()).toEqual(secrets)
    store.forget()
    expect(await store.load()).toBeUndefined()
  })
})
