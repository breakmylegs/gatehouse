// An ntfy server that needs a sign-in (owner, 4 Nov: a user runs their own ntfy server behind a logon).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { Broker } from "../src/broker.js"
import {
  NtfyChannel,
  NtfySecretStore,
  ntfyAuthHeader,
  randomTopic,
  type NtfySettings,
} from "../src/push/ntfy.js"
import { PlainProtector } from "../src/relay/protector.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-ntfy-auth-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const verdict = {
  outcome: "escalate" as const,
  ruleId: "package-install",
  reason: "Needs approval",
  risk: 60,
  decidedBy: "rules" as const,
  policyHash: "h",
}

function setup(settings: Partial<NtfySettings>, secret: string | undefined) {
  const calls: Array<{
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
  }> = []
  const s: NtfySettings = {
    enabled: true,
    server: "https://ntfy.internal.example",
    topic: randomTopic(),
    replyTopic: randomTopic(),
    maxRisk: 69,
    ...settings,
  }
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    })
    return new Response('{"id":"m1","time":1}', { status: 200 })
  }) as typeof fetch
  const broker = new Broker({ phoneExpiryMs: 60_000, hardTimeoutMs: 600_000, redact: (v) => v })
  const logged: string[] = []
  const channel = new NtfyChannel({
    broker,
    settings: () => s,
    redact: (t) => t,
    expiryMs: () => 60_000,
    onRefused: () => undefined,
    log: (l) => logged.push(l),
    fetchImpl,
    secret: async () => secret,
  })
  broker.request({
    kind: "permission",
    sessionId: "s1",
    toolUseId: "t1",
    toolName: "Bash",
    input: { command: "npm install left-pad" },
    cwd: "C:/dev/app",
    project: "app",
    verdict,
  })
  return { channel, calls, view: broker.list()[0]!, logged }
}

describe("an ntfy server that needs a sign-in", () => {
  it("signs in with an access token or a user name and password, and sends nothing when the secret is missing", async () => {
    expect(await ntfyAuthHeader({}, async () => "x")).toEqual({})
    expect(await ntfyAuthHeader({ auth: "token" }, async () => "tk_abc")).toEqual({
      Authorization: "Bearer tk_abc",
    })
    expect(await ntfyAuthHeader({ auth: "basic", user: "codehouse" }, async () => "p@ss")).toEqual({
      Authorization: `Basic ${Buffer.from("codehouse:p@ss").toString("base64")}`,
    })
    await expect(ntfyAuthHeader({ auth: "token" }, async () => undefined)).rejects.toThrow(
      /sign-in for this ntfy server is missing/,
    )
  })

  it("puts the sign-in on the notification and on the buttons the phone sends, and on the test", async () => {
    const { channel, calls, view } = setup({ auth: "token" }, "tk_secret")
    await channel.notify(view)
    expect(calls[0]?.headers.Authorization).toBe("Bearer tk_secret")
    const actions = calls[0]?.body.actions as Array<{
      label: string
      headers?: Record<string, string>
    }>
    expect(actions.map((a) => [a.label, a.headers?.Authorization])).toEqual([
      ["Approve", "Bearer tk_secret"],
      ["Deny", "Bearer tk_secret"],
    ])
    expect(await channel.test()).toMatchObject({ ok: true })
    expect(calls[1]?.headers.Authorization).toBe("Bearer tk_secret")
  })

  it("sends no sign-in to a server that needs none, and nothing at all when the secret is gone", async () => {
    const open = setup({}, undefined)
    await open.channel.notify(open.view)
    expect(open.calls[0]?.headers.Authorization).toBeUndefined()
    const actions = open.calls[0]?.body.actions as Array<{ headers?: unknown }>
    expect(actions.every((a) => a.headers === undefined)).toBe(true)
    const gone = setup({ auth: "basic", user: "codehouse" }, undefined)
    await gone.channel.notify(gone.view)
    expect(gone.calls).toHaveLength(0)
    expect(gone.channel.status().lastError).toMatch(/sign-in for this ntfy server is missing/)
    expect(gone.logged.join("\n")).not.toMatch(/Bearer|Basic/)
  })

  it("keeps the secret sealed in its own file, and forgets it", async () => {
    const store = new NtfySecretStore(path.join(dir, "ntfy.sealed"), new PlainProtector())
    expect(store.has()).toBe(false)
    expect(await store.load()).toBeUndefined()
    await store.save("tk_sealed")
    expect(store.has()).toBe(true)
    expect(await store.load()).toBe("tk_sealed")
    store.forget()
    expect(await store.load()).toBeUndefined()
  })
})
