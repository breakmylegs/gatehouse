import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify, { type FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PolicyEngine, PolicyStore } from "@gatehouse/policy"
import { registerFilesRoutes } from "../src/files-api.js"
import type { AdminContext } from "../src/api.js"

const REPO = path.resolve(import.meta.dirname, "../../..")
let root: string
let ws: string
let outside: string
let app: FastifyInstance
const revealed: string[] = []
// Save a copy: where the save window answers, what was recorded, and whether recording works.
let saveTo: string | undefined
const copied: Array<{ event: string; input: Record<string, unknown> }> = []
let audited = true
// What the session wrote outside its folder (owner, 4 Nov).
const written = new Set<string>()
// Whether session s1 is still open (O13: a preview ends with its session).
let s1Open = true

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-files-")))
  ws = path.join(root, "ws")
  outside = path.join(root, "outside")
  fs.mkdirSync(path.join(ws, "src"), { recursive: true })
  fs.mkdirSync(path.join(ws, "site"), { recursive: true })
  fs.mkdirSync(path.join(ws, ".git"), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(ws, "src", "a.ts"), "export const a = 1\n")
  fs.writeFileSync(path.join(ws, "README.md"), "# Hello\n")
  fs.writeFileSync(path.join(ws, ".env"), "SECRET=1\n")
  fs.writeFileSync(path.join(ws, "logo.bin"), Buffer.from([0, 1, 2, 3, 255]))
  fs.writeFileSync(path.join(ws, "site", "index.html"), "<h1>Weather</h1>")
  fs.writeFileSync(path.join(outside, "private.txt"), "not yours")
  fs.writeFileSync(path.join(outside, "plan.md"), "# The plan Claude wrote\n")
  fs.writeFileSync(path.join(outside, ".env"), "SECRET=2\n")
  try {
    fs.symlinkSync(outside, path.join(ws, "link"), "junction")
  } catch {
    // Junctions need no special rights on Windows; on other systems this case is skipped below.
  }
  const store = new PolicyStore({
    rulesPath: path.join(REPO, "policy", "rules.yaml"),
    workspaceRootsOverride: [root],
  })
  store.load()
  const ctx = {
    engine: new PolicyEngine({ getPolicy: () => store.current }),
    sessionCwd: (id: string) => (id === "s1" && s1Open ? ws : undefined),
    sessionWrote: (id: string, abs: string) => id === "s1" && written.has(abs.toLowerCase()),
    reveal: (abs: string) => void revealed.push(abs),
    saveAs: async () => saveTo,
    audit: { record: async (e: never) => (copied.push(e), audited) },
    store,
  } as unknown as AdminContext
  app = Fastify()
  registerFilesRoutes(app, ctx)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  fs.rmSync(root, { recursive: true, force: true })
})

const get = (url: string) => app.inject({ method: "GET", url })

describe("a file the session wrote outside its folder (owner, 4 Nov)", () => {
  it("opens in the pane, copies out and shows in Explorer, while one it did not write stays refused", async () => {
    const plan = path.join(outside, "plan.md")
    const q = (p: string) => `session=s1&path=${encodeURIComponent(p)}`
    expect((await get(`/api/files/read?${q(plan)}`)).statusCode).toBe(403)
    written.add(plan.toLowerCase())
    const r = await get(`/api/files/read?${q(plan)}`)
    expect(r.json()).toMatchObject({ kind: "text", text: "# The plan Claude wrote\n" })
    const shown = await app.inject({
      method: "POST",
      url: "/api/files/reveal",
      payload: { session: "s1", path: plan },
    })
    expect(shown.statusCode).toBe(200)
    expect(revealed.at(-1)).toBe(plan)
    revealed.length = 0
    expect((await get(`/api/files/read?${q(path.join(outside, "private.txt"))}`)).statusCode).toBe(
      403,
    )
    expect(
      (await get(`/api/files/read?session=s9&path=${encodeURIComponent(plan)}`)).statusCode,
    ).toBe(404)
  })

  it("still never opens a secrets file, even one the session wrote", async () => {
    const env = path.join(outside, ".env")
    written.add(env.toLowerCase())
    const r = await get(`/api/files/read?session=s1&path=${encodeURIComponent(env)}`)
    expect(r.json()).toMatchObject({ kind: "blocked" })
  })
})

describe("the files panel", () => {
  it("lists the session folder, folders first, without .git", async () => {
    const r = (await get("/api/files/list?session=s1")).json()
    const names = r.entries.map((e: { name: string }) => e.name)
    expect(names.slice(0, 2)).toEqual(expect.arrayContaining(["site", "src"]))
    expect(names).toContain("README.md")
    expect(names).not.toContain(".git")
    const sub = (await get("/api/files/list?session=s1&dir=src")).json()
    expect(sub.entries).toEqual([
      expect.objectContaining({ name: "a.ts", rel: "src/a.ts", kind: "file" }),
    ])
  })

  it("never leaves the session folder, by .. or through a junction", async () => {
    expect((await get("/api/files/list?session=s1&dir=..")).statusCode).toBe(403)
    expect((await get("/api/files/read?session=s1&path=../outside/private.txt")).statusCode).toBe(
      403,
    )
    if (fs.existsSync(path.join(ws, "link")))
      expect((await get("/api/files/read?session=s1&path=link/private.txt")).statusCode).toBe(403)
    expect((await get("/api/files/list?session=nobody")).statusCode).toBe(404)
  })

  it("reads text, says when a file is not text, and never opens a secrets file", async () => {
    expect((await get("/api/files/read?session=s1&path=src/a.ts")).json()).toMatchObject({
      kind: "text",
      text: "export const a = 1\n",
    })
    expect((await get("/api/files/read?session=s1&path=logo.bin")).json()).toMatchObject({
      kind: "binary",
    })
    const env = (await get("/api/files/read?session=s1&path=.env")).json()
    expect(env.kind).toBe("blocked")
    expect(JSON.stringify(env)).not.toContain("SECRET=1")
  })

  it("previews a page sandboxed, only with its token, and never serves a blocked file", async () => {
    const { base } = (
      await app.inject({ method: "POST", url: "/api/files/preview", payload: { session: "s1" } })
    ).json()
    expect(base).toMatch(/^\/preview\/[A-Za-z0-9_-]{20,}\/$/)
    const page = await get(`${base}site/index.html`)
    expect(page.statusCode).toBe(200)
    expect(page.headers["content-security-policy"]).toContain("sandbox")
    expect(page.body).toContain("Weather")
    expect((await get(`${base}site/`)).body).toContain("Weather")
    expect((await get(`${base}.env`)).statusCode).toBe(403)
    expect((await get(`${base}..%2Foutside%2Fprivate.txt`)).statusCode).toBe(404)
    expect((await get("/preview/not-a-token/site/index.html")).statusCode).toBe(404)
  })

  it("ends a preview address when its session closes, and does not bring it back (O13)", async () => {
    const { base } = (
      await app.inject({ method: "POST", url: "/api/files/preview", payload: { session: "s1" } })
    ).json()
    expect((await get(`${base}site/index.html`)).statusCode).toBe(200)
    s1Open = false
    try {
      const gone = await get(`${base}site/index.html`)
      expect(gone.statusCode).toBe(404)
      expect(gone.json().error).toMatch(/preview has ended/)
    } finally {
      s1Open = true
    }
    // The same session open again gets a new address; the old one stays ended.
    expect((await get(`${base}site/index.html`)).statusCode).toBe(404)
    const again = (
      await app.inject({ method: "POST", url: "/api/files/preview", payload: { session: "s1" } })
    ).json()
    expect(again.base).not.toBe(base)
  })

  it("reveals a file in Explorer, inside the folder only", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/files/reveal",
      payload: { session: "s1", path: "src/a.ts" },
    })
    expect(ok.json()).toEqual({ ok: true })
    expect(revealed.at(-1)).toBe(path.join(ws, "src", "a.ts"))
    const no = await app.inject({
      method: "POST",
      url: "/api/files/reveal",
      payload: { session: "s1", path: "../outside/private.txt" },
    })
    expect(no.statusCode).toBe(403)
    expect(revealed).toHaveLength(1)
  })

  it("saves a copy where you choose, only after it is recorded, never a secrets file, and nothing when you cancel", async () => {
    const save = (p: string) =>
      app.inject({
        method: "POST",
        url: "/api/files/save-copy",
        payload: { session: "s1", path: p },
      })
    saveTo = undefined
    expect((await save("README.md")).json()).toEqual({ saved: null })
    expect(copied).toHaveLength(0)
    saveTo = path.join(outside, "README copy.md")
    audited = false
    expect((await save("README.md")).statusCode).toBe(503)
    expect(fs.existsSync(saveTo)).toBe(false)
    audited = true
    expect((await save("README.md")).json()).toEqual({ saved: saveTo })
    expect(fs.readFileSync(saveTo, "utf8")).toBe("# Hello\n")
    expect(copied.at(-1)).toMatchObject({
      event: "file_copied_out",
      input: { path: "README.md", to: saveTo },
    })
    expect((await save(".env")).statusCode).toBe(403)
    expect((await save("../outside/private.txt")).statusCode).toBe(403)
  })
})
