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
  const store = new PolicyStore({
    rulesPath: path.join(REPO, "policy", "rules.yaml"),
    workspaceRootsOverride: [root],
  })
  store.load()
  const ctx = {
    engine: new PolicyEngine({ getPolicy: () => store.current }),
    store,
    audit: { record: async (r: unknown) => (audited.push(r), true) },
    sessionCwd: (id: string) => (id === "s1" ? ws : undefined),
    pickFiles: async () => [path.join(elsewhere, "shot.png")],
  } as unknown as AdminContext
  app = Fastify()
  registerAttachRoutes(app, ctx)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  fs.rmSync(root, { recursive: true, force: true })
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
    expect(r.files[1].rel).toMatch(/^\.jcvc\/attachments\/[0-9a-f]{6}-shot\.png$/)
    expect(fs.readFileSync(path.join(ws, r.files[1].rel))).toEqual(Buffer.from([137, 80, 78, 71]))
    expect(JSON.stringify(audited)).toContain("files-attached")
  })

  it("never copies a file the policy floor blocks", async () => {
    const r = (
      await post("/api/files/attach", { session: "s1", paths: [path.join(elsewhere, ".env")] })
    ).json()
    expect(r.files[0].error).toMatch(/blocked/)
    const dir = path.join(ws, ".jcvc", "attachments")
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
    expect(ok.rel).toMatch(/^\.jcvc\/attachments\/[0-9a-f]{6}-evil\.png$/)
    expect(
      (await post("/api/files/attach-data", { session: "s1", type: "text/html", data: "PGgxPg==" }))
        .statusCode,
    ).toBe(415)
    expect(
      (await post("/api/files/attach-data", { session: "nobody", type: "image/png", data: "AQID" }))
        .statusCode,
    ).toBe(404)
  })

  it("opens the file window through the injected picker only for a running session", async () => {
    expect((await post("/api/files/pick-files", { session: "s1" })).json()).toEqual({
      paths: [path.join(elsewhere, "shot.png")],
    })
    expect((await post("/api/files/pick-files", { session: "nobody" })).statusCode).toBe(404)
  })
})
