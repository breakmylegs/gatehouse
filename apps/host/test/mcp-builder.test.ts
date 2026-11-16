// O39, the MCP builder: a server you make starts from a starter that runs at once (nothing to install), is reached by a
// session only through the in-process bridge, gets no credentials (invariant 6), runs inside its caps, and says when it
// is not running; the list of servers is read tolerantly and checks what you change.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterAll, describe, expect, it } from "vitest"
import { bridgeFor, bridgeName } from "../src/mcp-builder/bridge.js"
import { commandFor, McpRunner } from "../src/mcp-builder/runner.js"
import { BuiltServers } from "../src/mcp-builder/store.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack } from "./stack.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-mcp-builder-"))
const runners: McpRunner[] = []
afterAll(async () => {
  for (const r of runners) await r.stopAll()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A session's view of a bridge: an MCP client connected to its in-process instance. */
async function sessionSide(runner: McpRunner, name: string): Promise<Client> {
  const b = bridgeFor(runner, name)
  const [a, c] = InMemoryTransport.createLinkedPair()
  await b.instance.connect(a)
  const client = new Client({ name: "session", version: "1" })
  await client.connect(c)
  return client
}

describe("the MCP builder (O39)", () => {
  it("makes a server that runs at once, and a session reaches it through the bridge", async () => {
    const store = new BuiltServers(path.join(dir, "d1"))
    const s = await store.create("greeter")
    expect(s).toMatchObject({ name: "greeter", autostart: false, cpu: 20, memoryMb: 512, entry: "server.cjs" })
    const runner = new McpRunner({ store, log: () => undefined })
    runners.push(runner)
    const st = await runner.start("greeter")
    expect(st.error ?? "").toBe("")
    expect(st).toMatchObject({ state: "running", tools: [expect.objectContaining({ name: "hello" })] })
    expect(bridgeFor(runner, "greeter")).toMatchObject({ type: "sdk", name: bridgeName("greeter") })
    const session = await sessionSide(runner, "greeter")
    expect((await session.listTools()).tools.map((t) => t.name)).toEqual(["hello"])
    const r = await session.callTool({ name: "hello", arguments: { name: "Ana" } })
    expect(r.content).toEqual([{ type: "text", text: "Hello, Ana." }])
    // Stopped, the session is told so, and nothing hangs.
    await runner.stop("greeter")
    const after = await session.callTool({ name: "hello", arguments: { name: "Ana" } })
    expect(after).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/not running/) }] })
    await session.close()
  }, 60_000)

  it("gives a server none of the credential variables (invariant 6)", async () => {
    const store = new BuiltServers(path.join(dir, "d2"))
    await store.create("envcheck")
    fs.writeFileSync(
      path.join(store.folder("envcheck"), "server.cjs"),
      `const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js")
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js")
const server = new McpServer({ name: "envcheck", version: "1" })
server.registerTool("env", { description: "names" }, async () => ({ content: [{ type: "text", text: JSON.stringify(Object.keys(process.env).filter((k) => /ANTHROPIC|OAUTH/i.test(k))) }] }))
server.connect(new StdioServerTransport())
`,
    )
    const runner = new McpRunner({
      store,
      log: () => undefined,
      env: { ...process.env, ANTHROPIC_API_KEY: "sk-should-never-reach", CLAUDE_CODE_OAUTH_TOKEN: "tok", ANTHROPIC_AUTH_TOKEN: "t" },
    })
    runners.push(runner)
    expect((await runner.start("envcheck")).state).toBe("running")
    const r = await runner.client("envcheck")!.client.callTool({ name: "env", arguments: {} })
    expect(r.content).toEqual([{ type: "text", text: "[]" }])
    await runner.stop("envcheck")
  }, 60_000)

  it("says why a server that does not start failed, and runs inside its caps when it can", async () => {
    const store = new BuiltServers(path.join(dir, "d3"))
    await store.create("broken")
    fs.writeFileSync(path.join(store.folder("broken"), "server.cjs"), `console.error("no such thing here"); process.exit(3)`)
    const runner = new McpRunner({ store, log: () => undefined, startTimeoutMs: 10_000 })
    runners.push(runner)
    const st = await runner.start("broken")
    expect(st.state).toBe("failed")
    expect(st.error).toMatch(/no such thing here|closed|did not/i)
    const s = store.get("broken")!
    expect(commandFor(s, "C:/f", "C:/L.exe", "node")).toEqual({
      command: "C:/L.exe",
      args: ["--name", "codeh-mcp-broken", "--cpu", "20", "--memory-mb", "512", "--priority", "below", "--", "node", path.join("C:/f", "server.cjs")],
      limited: true,
    })
    expect(commandFor(s, "C:/f", undefined, "node")).toMatchObject({ command: "node", limited: false })
  }, 60_000)

  it("gives a running session a server with /mcp, keeps the Companion, and sends its calls to a person", async () => {
    const s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
    try {
      s.deps.builtBridge = (name) => ({ type: "sdk", name: `built-${name}`, instance: {} })
      let call: ToolCallResult | undefined
      let release: () => void = () => undefined
      const gate = new Promise<void>((r) => (release = r))
      s.sdk.turn = async (api) => {
        await gate
        const t = api.callTool("mcp__built-greeter__hello", { name: "Ana" })
        await s.waitForPending()
        // A server you built is not one the rules know, so its call waits for you like any such server's.
        expect(s.broker.list()[0]?.request.toolName).toBe("mcp__built-greeter__hello")
        s.broker.resolve(s.pendingId(), { kind: "decision", decision: "deny" }, "desktop")
        call = await t
      }
      const session = await s.manager.start({ cwd: s.repo })
      const done = new Promise<void>((res) => session.on("message", (m) => m.type === "result" && res()))
      session.prompt("go")
      await session.useBuilt("greeter")
      const q = s.sdk.queries.at(-1) as unknown as { mcpSets: Record<string, unknown>[] }
      expect(Object.keys(q.mcpSets.at(-1)!).sort()).toEqual(["built-greeter", "companion"])
      expect(session.builtServers()).toEqual(["greeter"])
      release()
      await done
      expect(call).toMatchObject({ executed: false })
      await session.close()
    } finally {
      await s.stop()
    }
  }, 90_000)

  it("reads its list tolerantly, keeps what it does not know, and checks names and limits", async () => {
    const data = path.join(dir, "d4")
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(
      path.join(data, "mcp-servers.json"),
      JSON.stringify({ later: 1, servers: [{ name: "ok-one", autostart: true, cpu: 50, memoryMb: 1024, entry: "server.cjs", extra: "kept" }, { name: "Bad Name" }, "junk", { name: "escape", entry: "../../x.js" }] }),
    )
    const store = new BuiltServers(data)
    expect(store.list().map((s) => s.name)).toEqual(["ok-one", "escape"])
    expect(store.get("escape")!.entry).toBe("server.cjs")
    await store.update("ok-one", { cpu: 10 })
    const raw = JSON.parse(fs.readFileSync(path.join(data, "mcp-servers.json"), "utf8"))
    expect(raw.later).toBe(1)
    expect(raw.servers[0]).toMatchObject({ cpu: 10, extra: "kept", autostart: true })
    expect(raw.servers).toContain("junk")
    await expect(store.update("ok-one", { cpu: 101 })).rejects.toThrow(/0 to 100/)
    await expect(store.update("ok-one", { memoryMb: 10 })).rejects.toThrow(/64 MB/)
    await expect(store.create("Bad Name")).rejects.toThrow(/lower case/)
    await expect(store.create("ok-one")).rejects.toThrow(/already/)
    expect(() => store.folder("../x")).toThrow()
  })
})
