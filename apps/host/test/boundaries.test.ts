// B17: a card for each provider saying where your words go, and which providers a project's chats may use.
import fs from "node:fs"
import path from "node:path"
import Fastify from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ProjectStore } from "../src/projects.js"
import { registerProviderRoutes } from "../src/providers/api.js"
import { buildStack, type Stack } from "./stack.js"

const temp = (name: string) => fs.mkdtempSync(path.join(process.env.TEMP ?? ".", name))

describe("which providers a project allows", () => {
  it("is every provider until you choose, is kept beside what a newer version wrote, and keeps at least one", async () => {
    const store = new ProjectStore(path.join(temp("gh-b17-"), "projects"))
    store.create("Client A")
    expect(store.providers("Client A")).toBeUndefined()
    fs.writeFileSync(
      path.join(store.dir, "Client A", "project.json"),
      JSON.stringify({ colour: "teal" }),
    )
    await store.setProviders("Client A", ["local"])
    expect(store.providers("Client A")).toEqual(["local"])
    expect(store.get("Client A")?.providers).toEqual(["local"])
    expect(store.list()[0]).toMatchObject({ name: "Client A", providers: ["local"] })
    expect(
      JSON.parse(fs.readFileSync(path.join(store.dir, "Client A", "project.json"), "utf8")),
    ).toEqual({
      colour: "teal",
      providers: ["local"],
    })
    await expect(store.setProviders("Client A", [])).rejects.toThrow(/at least one provider/)
    await store.setProviders("Client A", undefined)
    expect(store.providers("Client A")).toBeUndefined()
    // A provider this version does not know is not offered.
    fs.writeFileSync(
      path.join(store.dir, "Client A", "project.json"),
      JSON.stringify({ providers: ["claude", "someday"] }),
    )
    expect(store.providers("Client A")).toEqual(["claude"])
  })
})

describe("a chat in a project", () => {
  let s: Stack
  let projects: ProjectStore
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
    projects = new ProjectStore(path.join(s.dir, "projects"))
    s.deps.projects = projects
    s.deps.chatsDir = path.join(s.dir, "chats")
  }, 60000)
  afterAll(() => s.stop())

  it("does not start on a provider the project does not allow, and starts on one it does", async () => {
    projects.create("Local only")
    await projects.setProviders("Local only", ["local"])
    await expect(
      s.manager.start({ cwd: "x", kind: "chat", title: "t", chatProject: "Local only" }),
    ).rejects.toThrow(/allows only models on this computer, so this chat cannot use Claude/)
    projects.create("Claude only")
    await projects.setProviders("Claude only", ["claude"])
    const chat = await s.manager.start({
      cwd: "x",
      kind: "chat",
      title: "t",
      chatProject: "Claude only",
    })
    expect(chat.info().chatProject).toBe("Claude only")
  })
})

describe("where your words go, for each provider", () => {
  it("is saved only after it is recorded, keeps the rest of the settings, and refuses what it cannot read", async () => {
    const dir = temp("gh-b17-api-")
    const file = path.join(dir, "config.json")
    fs.writeFileSync(
      file,
      JSON.stringify({ redactTerms: [], providers: { multi: { enabled: true } }, newer: 1 }),
    )
    const config = { redactTerms: [] } as never
    const records: Array<{ event: string; input: Record<string, unknown> }> = []
    let audited = false
    const app = Fastify()
    registerProviderRoutes(app, {
      audit: { record: async (e: never) => (records.push(e), audited) } as never,
      config: () => config,
      configFile: file,
    })
    const put = (body: unknown) =>
      app.inject({ method: "PUT", url: "/api/providers/boundary", payload: body as object })
    const boundary = {
      keeps: "30 days",
      training: "no",
      region: "EU",
      zdr: "unknown",
      checkedAt: "2026-11-03",
      source: "IT",
    }
    expect((await put({ provider: "elsewhere", boundary })).statusCode).toBe(422)
    expect((await put({ provider: "claude", boundary: { training: "maybe" } })).statusCode).toBe(
      422,
    )
    // Not recorded, not saved.
    expect((await put({ provider: "claude", boundary })).statusCode).toBe(503)
    expect(JSON.parse(fs.readFileSync(file, "utf8")).providers).toEqual({
      multi: { enabled: true },
    })
    audited = true
    const r = await put({ provider: "claude", boundary })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ boundaries: { claude: boundary } })
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      redactTerms: [],
      newer: 1,
      providers: { multi: { enabled: true }, boundaries: { claude: boundary } },
    })
    expect(records.at(-1)).toMatchObject({
      event: "provider_boundary_changed",
      input: { provider: "claude", keeps: "30 days" },
    })
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
