// CH-06 (owner's Chat build): Open in Claude hands a chat to claude.ai in a separate program, and reads nothing back.
import { describe, expect, it, vi } from "vitest"
import {
  edgeArgs,
  findEdge,
  handOff,
  HandoffError,
  handoffUrl,
  hasAppLink,
  type Launcher,
} from "../src/chat/handoff.js"

const UUID = "6f1c2a9e-3b4d-4c1e-9a77-1d2e3f4a5b6c"

describe("the address to open", () => {
  it("is built from the template with a checked uuid", () => {
    expect(handoffUrl("chat", UUID)).toBe(`https://claude.ai/chat/${UUID}`)
    expect(handoffUrl("project", UUID)).toBe(`https://claude.ai/project/${UUID}`)
    expect(handoffUrl("new", undefined)).toBe("https://claude.ai/new")
    expect(handoffUrl("chat", UUID, { chat: "https://claude.ai/c/{uuid}" })).toBe(
      `https://claude.ai/c/${UUID}`,
    )
  })

  it("refuses an id that is not a uuid, and any address not on claude.ai itself", () => {
    for (const bad of [
      "",
      "abc",
      `${UUID}/../../x`,
      `${UUID}?x=1`,
      "6f1c2a9e-3b4d-4c1e-9a77-1d2e3f4a5b6",
    ])
      expect(() => handoffUrl("chat", bad), bad).toThrow(HandoffError)
    for (const chat of [
      "http://claude.ai/chat/{uuid}",
      "https://claude.ai.evil.example/chat/{uuid}",
      "https://evil.example/claude.ai/{uuid}",
      "https://user@claude.ai/chat/{uuid}",
      "https://claude.ai:8443/chat/{uuid}",
      "javascript:alert(1)//{uuid}",
    ])
      expect(() => handoffUrl("chat", UUID, { chat }), chat).toThrow(HandoffError)
  })
})

describe("starting Edge", () => {
  it("passes exactly --app and --profile-directory, and nothing else", () => {
    expect(edgeArgs(`https://claude.ai/chat/${UUID}`, "Profile 1")).toEqual([
      `--app=https://claude.ai/chat/${UUID}`,
      "--profile-directory=Profile 1",
    ])
    expect(edgeArgs("https://claude.ai/new")).toEqual([
      "--app=https://claude.ai/new",
      "--profile-directory=Default",
    ])
    expect(() => edgeArgs("https://claude.ai/new", "Default --remote")).toThrow(HandoffError)
  })

  // Mac fork: the Windows registry; on a Mac findEdge() and hasAppLink() are the Mac's (handoff-mac.test.ts).
  it.skipIf(process.platform !== "win32")("finds msedge.exe through the registry's App Paths, never a path written in", async () => {
    const query = vi.fn(async (_f: string, args: string[]) => {
      if (args[1]!.startsWith("HKCU")) throw new Error("not here")
      return "\r\nHKEY_LOCAL_MACHINE\\...\\msedge.exe\r\n    (Default)    REG_SZ    C:\\Edge\\msedge.exe\r\n"
    })
    expect(await findEdge(query)).toBe("C:\\Edge\\msedge.exe")
    expect(query.mock.calls.map((c) => c[1][1])).toEqual([
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe",
      "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe",
    ])
    expect(await findEdge(async () => "nothing useful")).toBeUndefined()
  })
})

describe("handing off", () => {
  const launcher = () => {
    const started: Array<[string, string[]]> = []
    const opened: string[] = []
    const l: Launcher = {
      detached: (file, args) => void started.push([file, args]),
      open: async (url) => void opened.push(url),
    }
    return { l, started, opened }
  }
  const url = `https://claude.ai/chat/${UUID}`

  it("opens an Edge app window by default, detached, with only those two arguments", async () => {
    const { l, started } = launcher()
    expect(
      await handOff(
        url,
        {},
        { launcher: l, findEdge: async () => "C:\\Edge\\msedge.exe", hasAppLink: async () => true },
      ),
    ).toEqual({
      target: "edge",
      opened: url,
    })
    expect(started).toEqual([
      ["C:\\Edge\\msedge.exe", [`--app=${url}`, "--profile-directory=Default"]],
    ])
  })

  it("uses the Claude app only when its link is turned on and Windows knows it, and Edge otherwise", async () => {
    const edge = async () => "C:\\Edge\\msedge.exe"
    const on = launcher()
    expect(
      await handOff(
        url,
        { target: "app", appLink: true },
        { launcher: on.l, findEdge: edge, hasAppLink: async () => true },
      ),
    ).toMatchObject({ target: "app", opened: `claude://claude.ai/chat/${UUID}` })
    const unknown = launcher()
    expect(
      await handOff(
        url,
        { target: "app", appLink: true },
        { launcher: unknown.l, findEdge: edge, hasAppLink: async () => false },
      ),
    ).toMatchObject({ target: "edge" })
    const off = launcher()
    expect(
      await handOff(
        url,
        { target: "app" },
        { launcher: off.l, findEdge: edge, hasAppLink: async () => true },
      ),
    ).toMatchObject({
      target: "edge",
    })
    const browser = launcher()
    expect(
      await handOff(
        url,
        { target: "browser" },
        { launcher: browser.l, findEdge: edge, hasAppLink: async () => false },
      ),
    ).toMatchObject({
      target: "browser",
    })
    expect(browser.opened).toEqual([url])
    await expect(
      handOff(
        url,
        {},
        { launcher: launcher().l, findEdge: async () => undefined, hasAppLink: async () => false },
      ),
    ).rejects.toThrow(/Edge was not found/)
  })

  // Mac fork: the Windows registry; on a Mac findEdge() and hasAppLink() are the Mac's (handoff-mac.test.ts).
  it.skipIf(process.platform !== "win32")("checks the app's link is registered before using it", async () => {
    expect(await hasAppLink(async () => "    URL Protocol    REG_SZ    ")).toBe(true)
    expect(
      await hasAppLink(async () => {
        throw new Error("no key")
      }),
    ).toBe(false)
  })
})

describe("Open in Claude from the desktop", () => {
  it("opens an imported chat by its own claude.ai id, and audits the target and the address", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const Fastify = (await import("fastify")).default
    const { ChatStore } = await import("../src/chat/db.js")
    const { registerHandoffRoutes } = await import("../src/chat/handoff-api.js")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-handoff-"))
    const store = new ChatStore({ file: path.join(dir, "chat.db"), redact: (v) => v })
    const imported = store.createConversation({
      title: "From claude.ai",
      provenance: {
        kind: "imported",
        source: "claude.ai",
        sourceUuid: UUID,
        exportDate: "2026-11-01",
        importBatchId: "b",
      },
    })
    const native = store.createConversation({ provenance: { kind: "native" } })
    const started: Array<[string, string[]]> = []
    const records: Array<Record<string, unknown>> = []
    const app = Fastify()
    registerHandoffRoutes(app, {
      store,
      settings: () => ({}),
      launcher: { detached: (f, a) => void started.push([f, a]), open: async () => undefined },
      findEdge: async () => "C:\Edge\msedge.exe",
      hasAppLink: async () => false,
      audit: { record: async (r: Record<string, unknown>) => (records.push(r), true) } as never,
      policyHash: () => "h",
    })
    const post = (payload: object) =>
      app.inject({ method: "POST", url: "/api/chat/handoff", payload })
    expect((await post({ conversation: imported.id })).json()).toEqual({ ok: true, target: "edge" })
    expect(started).toEqual([
      [
        "C:\Edge\msedge.exe",
        [`--app=https://claude.ai/chat/${UUID}`, "--profile-directory=Default"],
      ],
    ])
    expect(records[0]).toMatchObject({
      event: "chat_handoff",
      input: { target: "edge", url: `https://claude.ai/chat/${UUID}` },
    })
    expect((await post({ conversation: native.id })).statusCode).toBe(404)
    expect((await post({ new: true })).statusCode).toBe(200)
    expect(started.at(-1)?.[1][0]).toBe("--app=https://claude.ai/new")
    await app.close()
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
