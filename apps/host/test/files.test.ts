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
    sessionCwd: (id: string) => (id === "s1" ? ws : undefined),
    reveal: (abs: string) => void revealed.push(abs),
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
})
