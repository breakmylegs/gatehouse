// Chats with a model on this computer (ADR 0011). The runtime must listen on this computer, be new enough and have
// the model you allowed; every tool the model asks for goes through the session's own floor hook and canUseTool;
// what reaches the runtime is redacted; a model that keeps asking is stopped.
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { redactString } from "@gatehouse/policy"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerProviderRoutes } from "../src/providers/api.js"
import { localQuery, MAX_TOOL_ROUNDS } from "../src/providers/local-query.js"
import { checkRuntime, type LocalRuntimeConfig } from "../src/providers/local-runtime.js"
import type { QueryFn } from "../src/account.js"
import { buildStack, type Stack } from "./stack.js"

/** A stand-in runtime: Ollama's version and model list, and chat completions answered by `reply`. */
function fakeRuntime(opts: { version?: string; digest?: string } = {}) {
  const bodies: string[] = []
  const headers: http.IncomingHttpHeaders[] = []
  let reply: (n: number) => unknown = () => ({ role: "assistant", content: "Hello." })
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (d: Buffer) => (raw += d.toString()))
    req.on("end", () => {
      const send = (v: unknown) => {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify(v))
      }
      if (req.url === "/api/version") return send({ version: opts.version ?? "0.18.0" })
      if (req.url === "/api/tags")
        return send({ models: [{ name: "tiny", digest: opts.digest ?? "a".repeat(64) }] })
      if (req.url === "/v1/models") return send({ data: [{ id: "tiny" }] })
      if (req.url === "/moved") {
        res.statusCode = 302
        // Even to an address that would work, a redirect is never followed.
        res.setHeader("location", "/v1/models")
        return res.end()
      }
      if (req.url === "/v1/chat/completions") {
        bodies.push(raw)
        headers.push(req.headers)
        return send({
          choices: [{ message: reply(bodies.length) }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        })
      }
      res.statusCode = 404
      res.end()
    })
  })
  return {
    bodies,
    headers,
    setReply: (f: (n: number) => unknown) => (reply = f),
    start: () =>
      new Promise<string>((resolve) =>
        server.listen(0, "127.0.0.1", () =>
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
        ),
      ),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  }
}

const toolCall = (
  name: string,
  args: Record<string, unknown>,
  id = `call_${Math.random().toString(36).slice(2)}`,
) => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
})

describe("the runtime check", () => {
  let rt: ReturnType<typeof fakeRuntime>
  let url: string
  beforeEach(async () => {
    rt = fakeRuntime()
    url = await rt.start()
  })
  afterEach(() => rt.stop())
  const cfg = (c: Partial<LocalRuntimeConfig>): LocalRuntimeConfig => ({
    kind: "ollama",
    url,
    models: [{ name: "tiny" }],
    ...c,
  })

  it("allows a runtime on this computer with a model you listed, and nothing else", async () => {
    expect(await checkRuntime(cfg({}))).toMatchObject({
      ok: true,
      models: ["tiny"],
      version: "0.18.0",
    })
    const away = vi.fn<typeof fetch>()
    expect(await checkRuntime(cfg({ url: "http://10.0.0.5:11434" }), away)).toMatchObject({
      ok: false,
      code: "runtime.non-loopback",
    })
    expect(away).not.toHaveBeenCalled()
    expect(await checkRuntime(cfg({ models: [{ name: "other" }] }))).toMatchObject({
      ok: false,
      code: "runtime.no-models",
    })
    expect(
      await checkRuntime(cfg({ models: [{ name: "tiny", digest: "b".repeat(64) }] })),
    ).toMatchObject({ ok: false })
    expect(
      await checkRuntime(cfg({ models: [{ name: "tiny", digest: `sha256:${"a".repeat(64)}` }] })),
    ).toMatchObject({ ok: true })
    expect(await checkRuntime(cfg({ kind: "openai-compatible" }))).toMatchObject({
      ok: true,
      models: ["tiny"],
    })
    expect(await checkRuntime(cfg({ url: "http://127.0.0.1:1" }))).toMatchObject({
      ok: false,
      code: "runtime.unreachable",
    })
    // A redirect away from this computer is never followed.
    expect(
      await checkRuntime(cfg({ kind: "openai-compatible", url: `${url}/moved#` })),
    ).toMatchObject({ ok: false })
  })

  it("refuses an Ollama older than the fix for CVE-2026-7482", async () => {
    const old = fakeRuntime({ version: "0.17.0" })
    const oldUrl = await old.start()
    try {
      expect(await checkRuntime(cfg({ url: oldUrl }))).toMatchObject({
        ok: false,
        code: "runtime.version",
      })
    } finally {
      await old.stop()
    }
  })
})

describe("a chat on a model on this computer", () => {
  let s: Stack
  let rt: ReturnType<typeof fakeRuntime>
  let runtime: LocalRuntimeConfig
  let signedIn = true
  beforeEach(async () => {
    s = await buildStack({ config: {} })
    s.deps.chatsDir = path.join(s.dir, "chats")
    rt = fakeRuntime()
    runtime = { kind: "ollama", url: await rt.start(), models: [{ name: "tiny" }] }
    signedIn = true
    s.deps.local = {
      check: async (model) => {
        const r = await checkRuntime(runtime)
        if (!r.ok) throw new Error(r.reason)
        if (!r.models.includes(model)) throw new Error("not allowed")
      },
      queryFn: (model) =>
        ((params: Parameters<QueryFn>[0]) =>
          localQuery(params, {
            runtime,
            model,
            models: ["tiny"],
            account: () => (signedIn ? (s.sdk.account as never) : undefined),
            redact: (t) => redactString(t, { terms: s.deps.config().redactTerms }),
          })) as unknown as QueryFn,
    }
  })
  afterEach(async () => {
    await s.stop()
    await rt.stop()
  })

  const ask = async (text: string) => {
    const chat = await s.manager.start({ cwd: "x", kind: "chat", title: text, localModel: "tiny" })
    const results: Array<Record<string, unknown>> = []
    s.manager.on("message", ({ sessionId, message }) => {
      if (sessionId === chat.id && (message as { type?: string }).type === "result")
        results.push(message as never)
    })
    chat.prompt(text)
    return {
      chat,
      done: () =>
        vi
          .waitFor(() => expect(results.length).toBeGreaterThan(0), { timeout: 20_000 })
          .then(() => results[0]!),
    }
  }

  it("goes through your gateway with no key sent, and says where the words go", async () => {
    runtime = {
      kind: "gateway",
      url: runtime.url,
      models: [{ name: "tiny" }],
      forwardsTo: "Azure OpenAI",
    }
    s.deps.local!.label = () => "Azure OpenAI through your gateway"
    const { chat, done } = await ask("Hello there")
    expect((await done()).subtype).toBe("success")
    expect(chat.info()).toMatchObject({
      local: true,
      localLabel: "Azure OpenAI through your gateway",
    })
    expect(rt.headers.length).toBeGreaterThan(0)
    for (const h of rt.headers) {
      expect(h.authorization).toBeUndefined()
      expect(h["api-key"]).toBeUndefined()
      expect(h["x-api-key"]).toBeUndefined()
    }
  })

  it("answers, in Plan mode, as a chat marked as running on this computer", async () => {
    const { chat, done } = await ask("Hello there")
    expect((await done()).subtype).toBe("success")
    expect(chat.info()).toMatchObject({ kind: "chat", local: true, model: "tiny", mode: "plan" })
  })

  it("never reads a file the floor protects, and the runtime never sees it", async () => {
    const secret = path.join(s.deps.chatsDir!, ".env")
    fs.mkdirSync(s.deps.chatsDir!, { recursive: true })
    fs.writeFileSync(secret, "TOKEN=very-secret-value")
    rt.setReply((n) =>
      n === 1 ? toolCall("Read", { file_path: secret }) : { role: "assistant", content: "Done." },
    )
    const { done } = await ask("Read my env file")
    await done()
    expect(rt.bodies.join("\n")).not.toContain("very-secret-value")
    expect(rt.bodies[1]).toMatch(/Denied/)
    expect(s.records().some((r) => r.verdict?.ruleId === "secrets-files")).toBe(true)
  })

  it("redacts what it sends to the runtime, and stops a model that keeps asking for tools", async () => {
    s.deps.config().redactTerms = ["Falcon"]
    rt.setReply(() => toolCall("Read", { file_path: "C:/Users/x/.ssh/id_rsa" }))
    const { done } = await ask("Plan the Falcon launch")
    const result = await done()
    expect(result.subtype).toBe("error_max_turns")
    expect(rt.bodies).toHaveLength(MAX_TOOL_ROUNDS + 1)
    expect(rt.bodies.join("\n")).not.toMatch(/falcon/i)
  })

  it("asks canUseTool for every tool the model asks for, and runs only what it allows", async () => {
    fs.mkdirSync(s.deps.chatsDir!, { recursive: true })
    const notes = path.join(s.deps.chatsDir!, "notes.txt")
    fs.writeFileSync(notes, "the answer is 42")
    // Whatever the rules decide, a person here allows it, so nothing waits.
    s.broker.on("created", () =>
      setTimeout(
        () => s.broker.resolve(s.pendingId(), { kind: "decision", decision: "allow" }, "desktop"),
        10,
      ),
    )
    rt.setReply((n) =>
      n === 1
        ? toolCall("Read", { file_path: notes }, "call_read")
        : { role: "assistant", content: "42" },
    )
    const { done } = await ask("What is in my notes?")
    await done()
    expect(rt.bodies[1]).toContain("the answer is 42")
    const mine = s.records().filter((r) => r.toolUseId === "call_read")
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.some((r) => r.event === "self_approved")).toBe(false)
  })

  it("is refused without the model allowed, for research, and when the account is not in the organisation", async () => {
    await expect(s.manager.start({ cwd: "x", kind: "chat", localModel: "big" })).rejects.toThrow(
      /not allowed/,
    )
    await expect(
      s.manager.start({ cwd: "x", kind: "chat", localModel: "tiny", research: true }),
    ).rejects.toThrow(/web search/)
    await expect(s.manager.start({ cwd: s.repo, localModel: "tiny" })).rejects.toThrow(
      /Only a chat/,
    )
    signedIn = false
    await expect(s.manager.start({ cwd: "x", kind: "chat", localModel: "tiny" })).rejects.toThrow()
  })
})

describe("the settings for other providers", () => {
  it("saves only after recording, keeps the rest of the file, and refuses a runtime elsewhere", async () => {
    const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? ".", "gh-providers-api-"))
    try {
      const file = path.join(dir, "config.json")
      fs.writeFileSync(file, JSON.stringify({ redactTerms: [], somethingNewer: { kept: true } }))
      const config = { redactTerms: [] } as never
      const records: unknown[] = []
      let audited = true
      const app = Fastify()
      registerProviderRoutes(app, {
        audit: { record: async (e: unknown) => (records.push(e), audited) } as never,
        config: () => config,
        configFile: file,
        fetchFn: (async () => {
          throw new Error("offline")
        }) as never,
      })
      const put = (body: Record<string, unknown>) =>
        app.inject({ method: "PUT", url: "/api/providers", payload: body })
      const local = { kind: "ollama", url: "http://127.0.0.1:11434", models: [{ name: "tiny" }] }
      expect(
        (await put({ enabled: true, local: { ...local, url: "http://192.168.1.4:11434" } }))
          .statusCode,
      ).toBe(422)
      audited = false
      expect((await put({ enabled: true, local })).statusCode).toBe(503)
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).not.toHaveProperty("providers")
      audited = true
      const r = await put({ enabled: true, local })
      expect(r.json()).toMatchObject({
        enabled: true,
        check: { ok: false, code: "runtime.unreachable" },
      })
      const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      expect(saved).toMatchObject({
        somethingNewer: { kept: true },
        providers: { multi: { enabled: true }, local },
      })
      expect(records.at(-1)).toMatchObject({
        event: "providers_changed",
        input: { enabled: true, models: ["tiny"] },
      })
      // A runtime's settings take no key or password: a gateway holds the provider's credentials (ADR 0010).
      const withKey = await put({
        enabled: true,
        local: { ...local, kind: "gateway", apiKey: "sk-123" },
      })
      expect(withKey.statusCode).toBe(422)
      expect(JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8")))).not.toContain("sk-123")
      const gw = await put({
        enabled: true,
        local: { ...local, kind: "gateway", forwardsTo: "Azure OpenAI", keeps: "30-days" },
      })
      expect(gw.json()).toMatchObject({ label: "Azure OpenAI through your gateway" })
      await app.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
