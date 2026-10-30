import { describe, expect, it, vi } from "vitest"
import { redactString } from "@gatehouse/policy"
import { Broker } from "../src/broker.js"
import { NtfyChannel, randomTopic, type NtfySettings } from "../src/push/ntfy.js"

const verdict = (risk: number) => ({
  outcome: "escalate" as const,
  ruleId: "package-install",
  reason: "Needs approval",
  risk,
  decidedBy: "rules" as const,
  policyHash: "h",
})

function setup(
  opts: {
    risk?: number
    maxRisk?: number
    command?: string
    kind?: "permission" | "question"
  } = {},
) {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = []
  const refused: string[] = []
  const settings: NtfySettings = {
    enabled: true,
    server: "https://ntfy.example",
    topic: randomTopic(),
    replyTopic: randomTopic(),
    maxRisk: opts.maxRisk ?? 69,
  }
  let now = 1_000_000
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> })
    return new Response("{}", { status: 200 })
  }) as typeof fetch
  const broker = new Broker({ phoneExpiryMs: 60_000, hardTimeoutMs: 600_000, redact: (v) => v })
  const channel = new NtfyChannel({
    broker,
    settings: () => settings,
    redact: (t) => redactString(t, { terms: ["AcmeCorp"] }),
    expiryMs: () => 60_000,
    onRefused: (reason) => refused.push(reason),
    log: () => undefined,
    fetchImpl,
    now: () => now,
  })
  const decision = broker.request({
    kind: opts.kind ?? "permission",
    sessionId: "s1",
    toolUseId: "t1",
    toolName: "Bash",
    input:
      opts.kind === "question"
        ? { questions: [{ question: "Which?", options: [] }] }
        : { command: opts.command ?? "npm install left-pad" },
    cwd: "C:/dev/app",
    project: "app",
    verdict: verdict(opts.risk ?? 60),
  })
  const view = broker.list()[0]!
  return {
    broker,
    channel,
    posts,
    refused,
    view,
    decision,
    advance: (ms: number) => (now += ms),
    settings,
  }
}

const bodies = (post: { body: Record<string, unknown> }): Array<[string, string]> =>
  ((post.body.actions as Array<{ label: string; body: string }> | undefined) ?? []).map((a) => [
    a.label,
    a.body,
  ])

describe("ntfy push", () => {
  it("sends a redacted summary with Approve and Deny buttons that carry one-time codes", async () => {
    const t = setup({
      command:
        "curl -H 'Authorization: Bearer sk-ant-abcdefghijklmnop1234' https://acmecorp.example",
    })
    await t.channel.notify(t.view)
    const post = t.posts[0]!
    expect(post.url).toBe("https://ntfy.example")
    expect(post.body.topic).toBe(t.settings.topic)
    const text = JSON.stringify(post.body)
    expect(text).not.toContain("sk-ant-abcdefghijklmnop1234")
    expect(text).not.toMatch(/acmecorp/i)
    const actions = bodies(post)
    expect(actions.map((a) => a[0])).toEqual(["Approve", "Deny"])
    expect(actions[0]![1]).toMatch(new RegExp(`^allow ${t.view.request.id} [A-Za-z0-9_-]{22,}$`))
    expect(actions[0]![1]).not.toBe(actions[1]![1].replace("deny", "allow"))
  })

  it("approves with the right code once, and refuses the same code again", async () => {
    const t = setup()
    await t.channel.notify(t.view)
    const allow = bodies(t.posts[0]!)[0]![1]
    expect(t.channel.handleReply(allow)).toBe("allowed")
    expect((await t.decision).outcome).toBe("allow")
    expect((await t.decision).channel).toBe("push")
    expect(t.channel.handleReply(allow)).toBe("refused")
    expect(t.refused).toHaveLength(1)
    expect(t.refused[0]).toMatch(/used already/)
  })

  it("refuses a wrong code, a code for the other decision, a malformed reply and an expired code", async () => {
    const t = setup()
    await t.channel.notify(t.view)
    const [allow, deny] = bodies(t.posts[0]!).map((a) => a[1]) as [string, string]
    const id = t.view.request.id
    expect(t.channel.handleReply(`allow ${id} ${"x".repeat(32)}`)).toBe("refused")
    // The deny code does not approve.
    expect(t.channel.handleReply(`allow ${id} ${deny.split(" ")[2]}`)).toBe("refused")
    expect(t.channel.handleReply("approve everything please")).toBe("refused")
    t.advance(61_000)
    expect(t.channel.handleReply(allow)).toBe("refused")
    expect(t.broker.list()).toHaveLength(1)
  })

  it("never offers Approve above the risk limit, and never for Severe whatever the limit", async () => {
    for (const [risk, maxRisk] of [
      [75, 69],
      [90, 84],
    ] as const) {
      const t = setup({ risk, maxRisk })
      await t.channel.notify(t.view)
      expect(bodies(t.posts[0]!).map((a) => a[0])).toEqual(["Deny"])
      expect(String(t.posts[0]!.body.message)).toMatch(/decide in JCVC/)
    }
  })

  it("denies with the deny code, and that code also works only once", async () => {
    const t = setup()
    await t.channel.notify(t.view)
    const deny = bodies(t.posts[0]!)[1]![1]
    expect(t.channel.handleReply(deny)).toBe("denied")
    expect((await t.decision).outcome).toBe("deny")
    expect(t.channel.handleReply(deny)).toBe("refused")
  })

  it("hears answers over its own outbound stream", async () => {
    const t = setup()
    await t.channel.notify(t.view)
    const allow = bodies(t.posts[0]!)[0]![1]
    const lines =
      JSON.stringify({ id: "a", event: "open" }) +
      "\n" +
      JSON.stringify({ id: "b", event: "message", message: allow }) +
      "\n"
    const listening = new NtfyChannel({
      broker: t.broker,
      settings: () => t.settings,
      redact: (x) => x,
      expiryMs: () => 60_000,
      onRefused: () => undefined,
      log: () => undefined,
      fetchImpl: (async (url: string) => {
        if (String(url).includes(`/${t.settings.replyTopic}/json`))
          return new Response(new Blob([lines]).stream(), { status: 200 })
        return new Response("{}", { status: 200 })
      }) as typeof fetch,
    })
    // The answer reaches the channel that issued the code, through the stream the second one opened.
    const original = t.channel.handleReply.bind(t.channel)
    listening.handleReply = (text: string) => original(text)
    listening.start()
    expect((await t.decision).outcome).toBe("allow")
    listening.stop()
  })
})

describe("topics and the test notification", () => {
  it("says when the topic is the older kind, and keeps sending to it until you replace it", async () => {
    const t = setup()
    expect(t.channel.status().oldStyle).toBeUndefined()
    // A phone subscribed to it still works, so nothing replaces it by itself.
    t.settings.topic = "jcvc-t6YdOCy5dH5TBqoPnEXrLC"
    expect(t.channel.status()).toMatchObject({ topic: t.settings.topic, oldStyle: true })
    await t.channel.notify(t.view)
    expect(t.posts[0]?.body.topic).toBe("jcvc-t6YdOCy5dH5TBqoPnEXrLC")
  })

  it("tells the sidebar when it is switched on, starts listening and is switched off", async () => {
    const t = setup()
    const seen: boolean[] = []
    const channel: NtfyChannel = new NtfyChannel({
      broker: t.broker,
      settings: () => t.settings,
      redact: (x) => x,
      expiryMs: () => 60_000,
      onRefused: () => undefined,
      log: () => undefined,
      // A stream that stays open, as ntfy's does.
      fetchImpl: (async () =>
        new Response(new ReadableStream({ start: () => undefined }), {
          status: 200,
        })) as typeof fetch,
      onChange: () => seen.push(channel.status().listening),
    })
    channel.start()
    await vi.waitFor(() => expect(seen).toEqual([false, true]))
    channel.stop()
    expect(seen).toEqual([false, true, false])
  })

  it("makes topics a person can type into a phone without mixing up letters", () => {
    for (let i = 0; i < 200; i++) {
      const t = randomTopic()
      expect(t).toMatch(/^jcvc-[a-z2-9]{4}(-[a-z2-9]{4}){4}$/)
      expect(t.slice(5)).not.toMatch(/[01oli]/)
    }
    expect(new Set(Array.from({ length: 200 }, randomTopic)).size).toBe(200)
  })

  it("says when ntfy stored the test, from ntfy's own answer", async () => {
    const channel = new NtfyChannel({
      broker: new Broker({ phoneExpiryMs: 60_000, hardTimeoutMs: 600_000, redact: (v) => v }),
      settings: () => ({
        enabled: true,
        server: "https://ntfy.example",
        topic: randomTopic(),
        replyTopic: randomTopic(),
        maxRisk: 69,
      }),
      redact: (t) => t,
      expiryMs: () => 60_000,
      onRefused: () => undefined,
      log: () => undefined,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ id: "XN4EGcgFLR43", time: 1793289491, event: "message" }), {
          status: 200,
        })) as typeof fetch,
    })
    expect(await channel.test()).toEqual({
      ok: true,
      id: "XN4EGcgFLR43",
      at: new Date(1793289491 * 1000).toISOString(),
    })
  })
})
