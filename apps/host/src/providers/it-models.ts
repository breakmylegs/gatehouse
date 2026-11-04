import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/**
 * B19: IT's list of the models this computer may run, beside its policy (B37) in the folder only an administrator can
 * change: models.json, signed with the same key as policy.yaml (models.json.sig, Ed25519, base64). When it is there,
 * only models it names can be used, whatever the settings list. One that does not check out allows no model at all
 * (fail closed), and the reason is shown. No models.json: nothing changes.
 *
 *   { "version": 1, "models": ["qwen3:8b", "llama3.2:*"] }
 *
 * A name may end in * for every tag of a model.
 */
export type ItModels = { ok: true; models?: string[] } | { ok: false; reason: string }

const NAME = /^[\w.:/-]{1,100}\*?$/

export function readItModels(dir: string | undefined): ItModels {
  if (!dir) return { ok: true }
  const file = path.join(dir, "models.json")
  if (!fs.existsSync(file)) return { ok: true }
  const fail = (reason: string): ItModels => ({ ok: false, reason })
  try {
    const data = fs.readFileSync(file)
    const sigFile = path.join(dir, "models.json.sig")
    const keyFile = path.join(dir, "key.pem")
    if (!fs.existsSync(sigFile)) return fail("models.json has no signature (models.json.sig)")
    if (!fs.existsSync(keyFile)) return fail("there is no key to check it with (key.pem)")
    const key = crypto.createPublicKey(fs.readFileSync(keyFile, "utf8"))
    if (key.asymmetricKeyType !== "ed25519") return fail("key.pem is not an Ed25519 public key")
    const sig = Buffer.from(fs.readFileSync(sigFile, "utf8").trim(), "base64")
    if (!crypto.verify(null, data, key, sig))
      return fail("the signature does not match models.json, so it may have been changed")
    const raw = JSON.parse(data.toString("utf8")) as unknown
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
    if (o.version !== 1) return fail("models.json needs version 1")
    if (!Array.isArray(o.models) || o.models.some((m) => typeof m !== "string" || !NAME.test(m)))
      return fail("models.json needs a list of model names under models")
    return { ok: true, models: o.models as string[] }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

/** Whether IT's list allows a model: no list allows any, and a name ending in * allows every tag of it. */
export function itAllows(list: ItModels, model: string): boolean {
  if (!list.ok) return false
  if (!list.models) return true
  return list.models.some((m) => (m.endsWith("*") ? model.startsWith(m.slice(0, -1)) : m === model))
}
