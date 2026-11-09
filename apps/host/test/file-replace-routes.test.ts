// Backlog G35: the search and replace routes. A replace is recorded and checkpointed before anything is written, so
// Undo in Changes puts the files back; a secrets file is never changed; a folder outside git is refused.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify, { type FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PolicyEngine, PolicyStore } from "@gatehouse/policy"
import { listCheckpoints } from "@gatehouse/shared/node"
import { registerFilesRoutes } from "../src/files-api.js"
import type { AdminContext } from "../src/api.js"

const REPO = path.resolve(import.meta.dirname, "../../..")
let root: string
let ws: string
let plain: string
let app: FastifyInstance
let audited = true
const recorded: string[] = []
const git = (...a: string[]) =>
  execFileSync("git", a, { cwd: ws, encoding: "utf8", windowsHide: true })

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-replace-")))
  ws = path.join(root, "shop")
  plain = path.join(root, "plain")
  fs.mkdirSync(path.join(ws, "src"), { recursive: true })
  fs.mkdirSync(plain)
  git("init", "--quiet")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "T")
  fs.writeFileSync(path.join(ws, "src", "basket.ts"), "export const basket = []\n")
  fs.writeFileSync(path.join(ws, ".env"), "BASKET_KEY=1\n")
  git("add", "src")
  git("commit", "--quiet", "-m", "first")
  fs.writeFileSync(path.join(plain, "notes.txt"), "basket\n")
  const store = new PolicyStore({
    rulesPath: path.join(REPO, "policy", "rules.yaml"),
    workspaceRootsOverride: [root],
  })
  store.load()
  const ctx = {
    engine: new PolicyEngine({ getPolicy: () => store.current }),
    sessionCwd: (id: string) => (id === "s1" ? ws : id === "s2" ? plain : undefined),
    audit: { record: async (e: { event: string }) => (recorded.push(e.event), audited) },
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

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, payload })

describe("search and replace across files", { timeout: 120_000 }, () => {
  it("searches the session's folder", async () => {
    const r = await app.inject({ method: "GET", url: "/api/files/search?session=s1&q=basket" })
    expect(r.json().matches.map((m: { path: string }) => m.path)).toContain("src/basket.ts")
    expect(
      (await app.inject({ method: "GET", url: "/api/files/search?session=zz&q=x" })).statusCode,
    ).toBe(404)
  })

  it("replaces after the preview, recorded and checkpointed first, and never in a secrets file", async () => {
    const body = { session: "s1", pattern: "basket", caseSensitive: false, replacement: "cart" }
    const preview = (
      await post("/api/files/replace/preview", { ...body, paths: ["src/basket.ts", ".env"] })
    ).json()
    expect(preview.skipped.map((s: { path: string }) => s.path)).toEqual([".env"])
    // Not recorded, not changed.
    audited = false
    expect((await post("/api/files/replace", { ...body, files: preview.files })).statusCode).toBe(
      503,
    )
    expect(fs.readFileSync(path.join(ws, "src", "basket.ts"), "utf8")).toBe(
      "export const basket = []\n",
    )
    audited = true
    const before = (await listCheckpoints(ws, "s1")).length
    const done = (await post("/api/files/replace", { ...body, files: preview.files })).json()
    expect(done).toMatchObject({ changed: ["src/basket.ts"], count: 1 })
    expect(fs.readFileSync(path.join(ws, "src", "basket.ts"), "utf8")).toBe(
      "export const cart = []\n",
    )
    expect(fs.readFileSync(path.join(ws, ".env"), "utf8")).toBe("BASKET_KEY=1\n")
    // The checkpoint taken first is the one Undo in Changes goes back to.
    const after = await listCheckpoints(ws, "s1")
    expect(after.length).toBeGreaterThan(before)
    expect(after.map((c) => c.ref)).toContain(done.checkpoint)
    expect(recorded.filter((e) => e === "files_replaced")).toHaveLength(2)
  })

  it("saves your edit only over the version you opened, never to a secrets file, and records it (G33)", async () => {
    const read = async (p: string) =>
      (
        await app.inject({
          method: "GET",
          url: `/api/files/read?session=s1&path=${encodeURIComponent(p)}`,
        })
      ).json() as { kind: string; text: string; hash: string }
    const opened = await read("src/basket.ts")
    const save = (text: string, hash = opened.hash, p = "src/basket.ts") =>
      post("/api/files/save", { session: "s1", path: p, text, hash })
    // Changed outside after you opened it: not saved.
    fs.writeFileSync(path.join(ws, "src", "basket.ts"), "export const changed = 1\n")
    expect((await save("mine\n")).statusCode).toBe(409)
    expect(fs.readFileSync(path.join(ws, "src", "basket.ts"), "utf8")).toBe(
      "export const changed = 1\n",
    )
    const again = await read("src/basket.ts")
    audited = false
    expect((await save("mine\n", again.hash)).statusCode).toBe(503)
    audited = true
    const r = await save("mine\n", again.hash)
    expect(r.json()).toMatchObject({ saved: true })
    expect(fs.readFileSync(path.join(ws, "src", "basket.ts"), "utf8")).toBe("mine\n")
    expect(recorded).toContain("file_saved")
    // A secrets file is never shown, and never saved; nor is a file out of the folder.
    expect((await save("X=2\n", "any", ".env")).statusCode).toBe(403)
    expect(fs.readFileSync(path.join(ws, ".env"), "utf8")).toBe("BASKET_KEY=1\n")
    expect((await save("x", "any", "../plain/notes.txt")).statusCode).toBe(403)
  })

  it("refuses to replace in a folder that is not in git, since it could not be undone", async () => {
    const body = { session: "s2", pattern: "basket", replacement: "cart" }
    const preview = (
      await post("/api/files/replace/preview", { ...body, paths: ["notes.txt"] })
    ).json()
    const r = await post("/api/files/replace", { ...body, files: preview.files })
    expect(r.statusCode).toBe(409)
    expect(fs.readFileSync(path.join(plain, "notes.txt"), "utf8")).toBe("basket\n")
  })
})
