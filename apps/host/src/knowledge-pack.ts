/**
 * D-080, signed knowledge packs (Frontier build). A project's knowledge, its ADRs (docs/adr/*.md), its glossary
 * settings (.codehouse/glossary.yml) and what it tells agents (CLAUDE.md, AGENTS.md), exported as one pack signed with
 * this computer's Ed25519 key, and imported into another project only when the signature checks against a key you
 * trust (Settings, the team keys also used for C-055's rule packs) and every path is one of those files. A pack changed
 * after signing, signed by another key, or naming any other path is refused, and nothing is written. Claude Code's own
 * settings files are never carried: they could change what a session may do. The private key is kept sealed with the
 * computer's protection (DPAPI on Windows), never shown or sent.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

export interface KnowledgeFile {
  path: string
  text: string
}

export interface KnowledgePack {
  v: 1
  kind: "codehouse-knowledge"
  project: string
  createdAt: string
  files: KnowledgeFile[]
}

/** What is written to disk and shared: the pack's bytes, its signature, and the key that signed it. */
export interface SignedKnowledgePack {
  pack: string
  signature: string
  publicKey: string
}

const MAX_FILE = 512 * 1024
const MAX_FILES = 300

/** Whether a path may be in a pack: an ADR, the glossary settings, or what the project tells agents. */
export function allowedPath(p: string): boolean {
  // One folder level for ADRs and exact names otherwise, so no path can climb out of the project or name another file.
  return /^docs\/adr\/[^/]+\.md$/i.test(p) || p === ".codehouse/glossary.yml" || p === "CLAUDE.md" || p === "AGENTS.md"
}

/** The project's knowledge files as they are now. */
export function knowledgeFiles(root: string): KnowledgeFile[] {
  const out: KnowledgeFile[] = []
  const add = (rel: string) => {
    try {
      const abs = path.join(root, rel)
      const st = fs.lstatSync(abs)
      if (!st.isFile() || st.size > MAX_FILE) return
      out.push({ path: rel, text: fs.readFileSync(abs, "utf8") })
    } catch {
      // not there
    }
  }
  let adrs: string[] = []
  try {
    adrs = fs.readdirSync(path.join(root, "docs", "adr")).filter((n) => n.toLowerCase().endsWith(".md")).sort()
  } catch {
    adrs = []
  }
  for (const n of adrs.slice(0, MAX_FILES)) add(`docs/adr/${n}`)
  for (const rel of [".codehouse/glossary.yml", "CLAUDE.md", "AGENTS.md"]) add(rel)
  return out
}

/** This computer's signing key: made once, the private half sealed, the public half shown so others can trust it. */
export class KnowledgeKey {
  constructor(
    private readonly file: string,
    private readonly sealer: { protect(b: Uint8Array): Promise<Uint8Array>; unprotect(b: Uint8Array): Promise<Uint8Array> },
  ) {}

  async #load(): Promise<{ publicKey: string; privateKey: crypto.KeyObject }> {
    if (fs.existsSync(this.file)) {
      const kept = JSON.parse(fs.readFileSync(this.file, "utf8")) as { publicKey: string; sealed: string }
      const pem = Buffer.from(await this.sealer.unprotect(Buffer.from(kept.sealed, "base64"))).toString("utf8")
      return { publicKey: kept.publicKey, privateKey: crypto.createPrivateKey(pem) }
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString()
    const sealed = Buffer.from(await this.sealer.protect(Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()))).toString("base64")
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify({ publicKey: pub, sealed }))
    return { publicKey: pub, privateKey }
  }

  async publicKey(): Promise<string> {
    return (await this.#load()).publicKey
  }

  async sign(pack: KnowledgePack): Promise<SignedKnowledgePack> {
    const k = await this.#load()
    const bytes = Buffer.from(JSON.stringify(pack), "utf8")
    return { pack: bytes.toString("base64"), signature: crypto.sign(null, bytes, k.privateKey).toString("base64"), publicKey: k.publicKey }
  }
}

export function makePack(root: string, project: string, now = new Date()): KnowledgePack {
  return { v: 1, kind: "codehouse-knowledge", project, createdAt: now.toISOString(), files: knowledgeFiles(root) }
}

const keyId = (pem: string) => crypto.createPublicKey(pem).export({ type: "spki", format: "der" }).toString("base64")

/** The pack inside, when its signature checks against a trusted key and every path is allowed; why not, otherwise. */
export function openPack(signed: unknown, trusted: readonly string[]): { ok: true; pack: KnowledgePack } | { ok: false; why: string } {
  const s = signed as Partial<SignedKnowledgePack> | undefined
  if (!s || typeof s.pack !== "string" || typeof s.signature !== "string" || typeof s.publicKey !== "string") return { ok: false, why: "That is not a knowledge pack." }
  let signer: string
  let trust: string[]
  try {
    signer = keyId(s.publicKey)
    trust = trusted.flatMap((t) => {
      try {
        return [keyId(t)]
      } catch {
        return []
      }
    })
  } catch {
    return { ok: false, why: "The key that signed it cannot be read." }
  }
  if (!trust.includes(signer)) return { ok: false, why: "It was signed by a key you do not trust. Add the sender's key in Settings first." }
  const bytes = Buffer.from(s.pack, "base64")
  if (!crypto.verify(null, bytes, crypto.createPublicKey(s.publicKey), Buffer.from(s.signature, "base64")))
    return { ok: false, why: "Its signature does not check: it was changed after it was signed." }
  let pack: KnowledgePack
  try {
    pack = JSON.parse(bytes.toString("utf8")) as KnowledgePack
  } catch {
    return { ok: false, why: "What is inside cannot be read." }
  }
  if (pack.v !== 1 || pack.kind !== "codehouse-knowledge" || !Array.isArray(pack.files)) return { ok: false, why: "That is not a knowledge pack." }
  const bad = pack.files.find((f) => typeof f?.path !== "string" || typeof f.text !== "string" || !allowedPath(f.path) || f.text.length > MAX_FILE)
  if (bad) return { ok: false, why: `It names a file a knowledge pack may not carry (${String(bad?.path).slice(0, 80)}).` }
  if (pack.files.length > MAX_FILES) return { ok: false, why: "It carries too many files." }
  return { ok: true, pack }
}

/** Writes an opened pack's files into a project; returns what it wrote and what it left as it was (the same already). */
export async function importPack(root: string, pack: KnowledgePack): Promise<{ written: string[]; same: string[] }> {
  const written: string[] = []
  const same: string[] = []
  for (const f of pack.files) {
    const abs = path.join(root, f.path)
    let now: string | undefined
    try {
      now = fs.readFileSync(abs, "utf8")
    } catch {
      now = undefined
    }
    if (now === f.text) {
      same.push(f.path)
      continue
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    await writeFileAtomic(abs, f.text)
    written.push(f.path)
  }
  return { written, same }
}
