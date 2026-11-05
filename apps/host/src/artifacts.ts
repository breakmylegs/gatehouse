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
export const ARTIFACT_KINDS = ["html", "svg", "markdown", "code"] as const

/** Kinds shown as text, never run in a frame (CH-03): a document, and code to read or copy. */
export const TEXT_KINDS: readonly ArtifactKind[] = ["markdown", "code"]
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
export const EXT: Record<ArtifactKind, string> = {
  html: "html",
  svg: "svg",
  markdown: "md",
  code: "txt",
}
const TYPE: Record<ArtifactKind, string> = {
  html: "text/html; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  code: "text/plain; charset=utf-8",
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
/** The words of the mark, in every artifact (B38, EU AI Act Article 50). */
export const AI_MARK = "AI-generated with Claude in Codehouse"

/**
 * Marks an artifact as made by AI where a program can read it (B38): a meta tag in a page's head (or a comment after
 * its doctype when it has no head), and a comment and a metadata element in a picture. Marked once: a second save of
 * marked content is left as it is.
 */
export function labelArtifact(kind: ArtifactKind, content: string): string {
  if (content.includes(AI_MARK)) return content
  // A document says so in a comment Markdown does not show; code is marked by its headers alone, since a comment
  // there would depend on its language.
  if (kind === "markdown") return `${content.replace(/\s+$/, "")}\n\n<!-- ${AI_MARK} -->\n`
  if (kind === "code") return content
  if (kind === "svg") {
    const comment = `<!-- ${AI_MARK} -->`
    const at = content.search(/<svg[\s>]/i)
    if (at < 0) return `${comment}\n${content}`
    const open = content.indexOf(">", at)
    if (open < 0) return `${comment}\n${content}`
    const metadata = `<metadata>${AI_MARK}</metadata>`
    // A picture with nothing inside (<svg/>) is opened up, so the metadata sits within it.
    if (content[open - 1] === "/")
      return `${content.slice(0, at)}${comment}\n${content.slice(at, open - 1).trimEnd()}>${metadata}</svg>${content.slice(open + 1)}`
    return `${content.slice(0, at)}${comment}\n${content.slice(at, open + 1)}${metadata}${content.slice(open + 1)}`
  }
  const meta = `<meta name="generator" content="${AI_MARK}">`
  const head = /<head[^>]*>/i.exec(content)
  if (head) return content.replace(head[0], `${head[0]}${meta}`)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(content)
  if (doctype) return content.replace(doctype[0], `${doctype[0]}\n${meta}`)
  return `${meta}\n${content}`
}

export function artifactHeaders(frameAncestor: string, kind: ArtifactKind): Record<string, string> {
  return {
    // Machine-readable for anything that fetches it (B38).
    "x-ai-generated": AI_MARK,
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
    const redacted = this.#redact(content)
    // Empty is refused before the mark is added, which would make it look like content.
    if (!redacted.trim()) throw new ArtifactError("invalid", "An artifact needs content.")
    const body = labelArtifact(k, redacted)
    const bytes = Buffer.byteLength(body, "utf8")
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
