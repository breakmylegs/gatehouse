import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify, { type FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PolicyEngine, PolicyStore } from "@gatehouse/policy"
import { registerAttachRoutes } from "../src/attach-api.js"
import type { AdminContext } from "../src/api.js"

const REPO = path.resolve(import.meta.dirname, "../../..")
let root: string
let ws: string
let elsewhere: string
/** A chat's own folder, outside your workspace folders as the real chats folder is (W1-11). */
let chatDir: string
let chatRoot: string
let app: FastifyInstance
const audited: unknown[] = []

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-attach-")))
  ws = path.join(root, "ws")
  elsewhere = path.join(root, "elsewhere")
  fs.mkdirSync(path.join(ws, "src"), { recursive: true })
  fs.mkdirSync(elsewhere, { recursive: true })
  fs.writeFileSync(path.join(ws, "src", "a.ts"), "x")
  fs.writeFileSync(path.join(elsewhere, "shot.png"), Buffer.from([137, 80, 78, 71]))
  fs.writeFileSync(path.join(elsewhere, ".env"), "SECRET=1")
  fs.writeFileSync(path.join(elsewhere, "sales.csv"), "month,total\nJan,10\n")
  fs.writeFileSync(path.join(elsewhere, "huge.pdf"), Buffer.alloc(21 * 1024 * 1024))
  chatRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-chats-")))
  chatDir = path.join(chatRoot, "garden")
  fs.mkdirSync(chatDir, { recursive: true })
  const store = new PolicyStore({
    rulesPath: path.join(REPO, "policy", "rules.yaml"),
    workspaceRootsOverride: [root],
  })
  store.load()
  const ctx = {
    engine: new PolicyEngine({ getPolicy: () => store.current }),
    store,
    audit: { record: async (r: unknown) => (audited.push(r), true) },
    sessionCwd: (id: string) => (id === "s1" ? ws : id === "c1" ? chatDir : undefined),
    pickFiles: async () => [path.join(elsewhere, "shot.png")],
  } as unknown as AdminContext
  app = Fastify()
  registerAttachRoutes(app, ctx)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(chatRoot, { recursive: true, force: true })
})

const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload })

describe("attachments for the composer", () => {
  it("mentions a file inside the folder where it is, and copies one from elsewhere into the folder", async () => {
    const r = (
      await post("/api/files/attach", {
        session: "s1",
        paths: [path.join(ws, "src", "a.ts"), path.join(elsewhere, "shot.png")],
      })
    ).json()
    expect(r.files[0].rel).toBe("src/a.ts")
    expect(r.files[1].rel).toMatch(/^\.codehouse\/attachments\/[0-9a-f]{6}-shot\.png$/)
    expect(fs.readFileSync(path.join(ws, r.files[1].rel))).toEqual(Buffer.from([137, 80, 78, 71]))
    expect(JSON.stringify(audited)).toContain("files-attached")
  })

  it("never copies a file the policy floor blocks", async () => {
    const r = (
      await post("/api/files/attach", { session: "s1", paths: [path.join(elsewhere, ".env")] })
    ).json()
    expect(r.files[0].error).toMatch(/blocked/)
    const dir = path.join(ws, ".codehouse", "attachments")
    const copied = fs.existsSync(dir) ? fs.readdirSync(dir) : []
    expect(copied.some((f) => f.includes(".env"))).toBe(false)
  })

  it("saves a pasted picture into the folder, and refuses anything that is not a picture", async () => {
    const ok = (
      await post("/api/files/attach-data", {
        session: "s1",
        name: "../../evil.png",
        type: "image/png",
        data: Buffer.from([1, 2, 3]).toString("base64"),
      })
    ).json()
    expect(ok.rel).toMatch(/^\.codehouse\/attachments\/[0-9a-f]{6}-evil\.png$/)
    expect(
      (await post("/api/files/attach-data", { session: "s1", type: "text/html", data: "PGgxPg==" }))
        .statusCode,
    ).toBe(415)
    expect(
      (await post("/api/files/attach-data", { session: "nobody", type: "image/png", data: "AQID" }))
        .statusCode,
    ).toBe(404)
  })

  it("takes any dropped file by its name, refusing a secrets file before anything is written (owner, 1 Nov)", async () => {
    const ok = (
      await post("/api/files/attach-data", {
        session: "s1",
        kind: "file",
        name: "C:\\Users\\me\\notes.txt",
        type: "text/plain",
        data: Buffer.from("hello").toString("base64"),
      })
    ).json()
    expect(ok.rel).toMatch(/^\.codehouse\/attachments\/[0-9a-f]{6}-notes\.txt$/)
    expect(fs.readFileSync(path.join(ws, ok.rel), "utf8")).toBe("hello")
    const dir = path.join(ws, ".codehouse", "attachments")
    const before = fs.readdirSync(dir).length
    const env = await post("/api/files/attach-data", {
      session: "s1",
      kind: "file",
      name: ".env",
      type: "application/octet-stream",
      data: Buffer.from("SECRET=1").toString("base64"),
    })
    expect(env.statusCode).toBe(403)
    expect(fs.readdirSync(dir).length).toBe(before)
    // A file needs its name, and a non-picture without kind "file" is still refused as a paste.
    expect(
      (
        await post("/api/files/attach-data", {
          session: "s1",
          kind: "file",
          type: "text/plain",
          data: "aGk=",
        })
      ).statusCode,
    ).toBe(400)
  })

  it("attaches a file to a chat, never a secrets file, and refuses one over the limit (W1-11)", async () => {
    const r = (
      await post("/api/files/attach", {
        session: "c1",
        paths: [
          path.join(elsewhere, "sales.csv"),
          path.join(elsewhere, ".env"),
          path.join(elsewhere, "huge.pdf"),
        ],
      })
    ).json() as { files: Array<{ path: string; rel?: string; error?: string }> }
    const [csv, env, huge] = r.files
    expect(csv?.rel).toMatch(/^\.codehouse\/attachments\/[0-9a-f]{6}-sales\.csv$/)
    expect(fs.readFileSync(path.join(chatDir, csv!.rel!), "utf8")).toContain("Jan,10")
    expect(env).toMatchObject({ error: "That file is blocked by the policy and was not attached." })
    expect(huge).toMatchObject({ error: "That file is over 20 MB." })
    expect(fs.readdirSync(path.join(chatDir, ".codehouse", "attachments"))).toHaveLength(1)
  })

  it("opens the file window through the injected picker only for a running session", async () => {
    expect((await post("/api/files/pick-files", { session: "s1" })).json()).toEqual({
      paths: [path.join(elsewhere, "shot.png")],
    })
    expect((await post("/api/files/pick-files", { session: "nobody" })).statusCode).toBe(404)
  })
})
