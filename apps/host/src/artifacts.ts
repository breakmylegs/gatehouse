import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

/**
 * Artifacts (owner's plan, W1-09, ADR 0003): a small page or picture Claude makes in a chat, kept as versions on the
 * Host and shown in a sandbox. Only what the Host stores is ever shown: the content is redacted first and cut to a
 * size, and it is served only with the headers below, which let it run its own scripts and nothing else.
 */
export const MAX_ARTIFACT_BYTES = 500_000
export const MAX_VERSIONS = 50
export const ARTIFACT_KINDS = ["html", "svg"] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export class ArtifactError extends Error {
  constructor(
    readonly code: "invalid" | "too-big" | "missing" | "full",
    message: string,
  ) {
    super(message)
  }
}

export interface ArtifactVersion {
  version: number
  bytes: number
  at: string
}
export interface ArtifactSummary {
  id: string
  title: string
  kind: ArtifactKind
  versions: ArtifactVersion[]
}

/** A Host session id. Anything else never reaches the disk. */
const SESSION = /^[0-9a-f-]{36}$/
const EXT: Record<ArtifactKind, string> = { html: "html", svg: "svg" }
const TYPE: Record<ArtifactKind, string> = {
  html: "text/html; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)

/**
 * The headers an artifact is sent with. The sandbox gives it an opaque origin with scripts and nothing else: no same
 * origin, forms, pop-ups or top navigation. Nothing can be fetched, so it cannot reach the Host, the network or your
 * files, even when Claude writes a call to. The window may frame it and nothing else may.
 */
export function artifactHeaders(frameAncestor: string, kind: ArtifactKind): Record<string, string> {
  return {
    "content-type": TYPE[kind],
    "content-security-policy": [
      "sandbox allow-scripts",
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src data: blob:",
      "font-src data:",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      `frame-ancestors ${frameAncestor}`,
    ].join("; "),
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  }
}

interface Index {
  artifacts: Array<{
    id: string
    title: string
    kind: ArtifactKind
    versions: ArtifactVersion[]
  }>
}

export class ArtifactStore {
  readonly #dir: string
  readonly #redact: (text: string) => string

  constructor(dir: string, redact: (text: string) => string = (t) => t) {
    this.#dir = path.resolve(dir)
    this.#redact = redact
  }

  #session(sessionId: string): string {
    if (!SESSION.test(sessionId)) throw new ArtifactError("invalid", "That is not a session.")
    return path.join(this.#dir, sessionId)
  }

  #readIndex(folder: string): Index {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(folder, "index.json"), "utf8")) as Index
      return Array.isArray(v.artifacts) ? v : { artifacts: [] }
    } catch {
      return { artifacts: [] }
    }
  }

  list(sessionId: string): ArtifactSummary[] {
    return this.#readIndex(this.#session(sessionId)).artifacts.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      versions: a.versions,
    }))
  }

  /** Keeps a new version. The same title is the same artifact, with the next version number. */
  async save(
    sessionId: string,
    title: string,
    kind: string,
    content: string,
  ): Promise<{ id: string; title: string; kind: ArtifactKind; version: ArtifactVersion }> {
    const folder = this.#session(sessionId)
    if (!(ARTIFACT_KINDS as readonly string[]).includes(kind))
      throw new ArtifactError("invalid", `An artifact is ${ARTIFACT_KINDS.join(" or ")}.`)
    const k = kind as ArtifactKind
    const t = title.replace(/\s+/g, " ").trim().slice(0, 80)
    const id = slug(t)
    if (!t || !id) throw new ArtifactError("invalid", "An artifact needs a title.")
    const body = this.#redact(content)
    const bytes = Buffer.byteLength(body, "utf8")
    if (!body.trim()) throw new ArtifactError("invalid", "An artifact needs content.")
    if (bytes > MAX_ARTIFACT_BYTES)
      throw new ArtifactError(
        "too-big",
        `An artifact can be up to ${MAX_ARTIFACT_BYTES / 1000} KB.`,
      )
    const index = this.#readIndex(folder)
    const entry = index.artifacts.find((a) => a.id === id)
    if (entry && entry.kind !== k)
      throw new ArtifactError(
        "invalid",
        `"${t}" is already a ${entry.kind} artifact. Use another title.`,
      )
    if (entry && entry.versions.length >= MAX_VERSIONS)
      throw new ArtifactError("full", `An artifact keeps up to ${MAX_VERSIONS} versions.`)
    const version: ArtifactVersion = {
      version: (entry?.versions.at(-1)?.version ?? 0) + 1,
      bytes,
      at: new Date().toISOString(),
    }
    fs.mkdirSync(path.join(folder, id), { recursive: true })
    await writeFileAtomic(path.join(folder, id, `v${version.version}.${EXT[k]}`), body)
    if (entry) entry.versions.push(version)
    else index.artifacts.push({ id, title: t, kind: k, versions: [version] })
    await writeFileAtomic(path.join(folder, "index.json"), JSON.stringify(index, null, 2) + "\n")
    return { id, title: t, kind: k, version }
  }

  /** Takes a version back out, for when it could not be recorded. */
  async discard(sessionId: string, id: string, version: number): Promise<void> {
    const folder = this.#session(sessionId)
    const index = this.#readIndex(folder)
    const entry = index.artifacts.find((a) => a.id === id)
    if (!entry) return
    fs.rmSync(path.join(folder, id, `v${version}.${EXT[entry.kind]}`), { force: true })
    entry.versions = entry.versions.filter((v) => v.version !== version)
    if (entry.versions.length === 0) index.artifacts = index.artifacts.filter((a) => a.id !== id)
    await writeFileAtomic(path.join(folder, "index.json"), JSON.stringify(index, null, 2) + "\n")
  }

  read(
    sessionId: string,
    id: string,
    version: number,
  ): { kind: ArtifactKind; title: string; content: string } | undefined {
    const folder = this.#session(sessionId)
    const entry = this.#readIndex(folder).artifacts.find((a) => a.id === id)
    if (!entry || !entry.versions.some((v) => v.version === version)) return undefined
    try {
      return {
        kind: entry.kind,
        title: entry.title,
        content: fs.readFileSync(path.join(folder, id, `v${version}.${EXT[entry.kind]}`), "utf8"),
      }
    } catch {
      return undefined
    }
  }
}
