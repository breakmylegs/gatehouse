// B19: IT's signed list of the models this computer may run.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { itAllows, readItModels } from "../src/providers/it-models.js"
import { checkRuntime, type LocalRuntimeConfig } from "../src/providers/local-runtime.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-itmodels-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519")
let n = 0

/** A managed folder with models.json, signed by `by` (IT's key unless given). */
function folder(body: unknown, opts: { by?: crypto.KeyObject; sig?: false; key?: false } = {}) {
  const dir = path.join(root, `m-${++n}`)
  fs.mkdirSync(dir)
  const data = Buffer.from(typeof body === "string" ? body : JSON.stringify(body))
  fs.writeFileSync(path.join(dir, "models.json"), data)
  if (opts.sig !== false)
    fs.writeFileSync(
      path.join(dir, "models.json.sig"),
      crypto.sign(null, data, opts.by ?? privateKey).toString("base64"),
    )
  if (opts.key !== false)
    fs.writeFileSync(
      path.join(dir, "key.pem"),
      publicKey.export({ type: "spki", format: "pem" }) as string,
    )
  return dir
}

const ollama = (models: string[]) => {
  const fetchFn = (async (url: string) => {
    const body = url.endsWith("/api/version")
      ? { version: "0.20.0" }
      : { models: models.map((name) => ({ name, digest: "sha256:aa" })) }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof fetch
  const cfg: LocalRuntimeConfig = {
    kind: "ollama",
    url: "http://127.0.0.1:11434",
    models: models.map((name) => ({ name })),
  } as LocalRuntimeConfig
  return { cfg, fetchFn }
}

describe("IT's list of models", () => {
  it("allows only the models it names, a name ending in * for every tag, once its signature checks out", () => {
    const list = readItModels(folder({ version: 1, models: ["qwen3:8b", "llama3.2:*"] }))
    expect(list).toEqual({ ok: true, models: ["qwen3:8b", "llama3.2:*"] })
    expect(itAllows(list, "qwen3:8b")).toBe(true)
    expect(itAllows(list, "qwen3:32b")).toBe(false)
    expect(itAllows(list, "llama3.2:3b")).toBe(true)
    expect(itAllows({ ok: true }, "anything")).toBe(true)
    expect(readItModels(path.join(root, "none"))).toEqual({ ok: true })
  })

  it("allows no model at all when it was changed, signed by another key, unsigned, has no key, or is malformed", () => {
    const other = crypto.generateKeyPairSync("ed25519").privateKey
    const changed = folder({ version: 1, models: ["qwen3:8b"] })
    fs.writeFileSync(
      path.join(changed, "models.json"),
      JSON.stringify({ version: 1, models: ["qwen3:*"] }),
    )
    for (const [dir, why] of [
      [changed, /does not match/],
      [folder({ version: 1, models: ["a"] }, { by: other }), /does not match/],
      [folder({ version: 1, models: ["a"] }, { sig: false }), /no signature/],
      [folder({ version: 1, models: ["a"] }, { key: false }), /no key/],
      [folder({ version: 2, models: ["a"] }), /version 1/],
      [folder({ version: 1, models: ["bad name!"] }), /list of model names/],
      [folder("{not json"), /JSON|Unexpected|Expected/],
    ] as const) {
      const list = readItModels(dir)
      expect(list.ok, String(why)).toBe(false)
      expect(list.ok ? "" : list.reason).toMatch(why)
      expect(itAllows(list, "a")).toBe(false)
    }
  })

  it("leaves out of the runtime's check any model IT has not allowed, and refuses every one when its list does not check out", async () => {
    const { cfg, fetchFn } = ollama(["qwen3:8b", "mystery:1b"])
    const r = await checkRuntime(cfg, fetchFn, { ok: true, models: ["qwen3:*"] })
    expect(r.ok && r.models).toEqual(["qwen3:8b"])
    expect(r.ok && r.left).toContainEqual({
      name: "mystery:1b",
      why: "IT has not allowed it on this computer",
    })
    const none = await checkRuntime(cfg, fetchFn, { ok: true, models: ["other:*"] })
    expect(none.ok).toBe(false)
    const broken = await checkRuntime(cfg, fetchFn, { ok: false, reason: "no key" })
    expect(broken).toMatchObject({ ok: false, code: "runtime.it-list" })
    expect(broken.ok ? "" : broken.reason).toContain("no key")
    expect((await checkRuntime(cfg, fetchFn)).ok && true).toBe(true)
  })
})
