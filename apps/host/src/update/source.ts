/**
 * Where updates come from: the GitHub releases of the JCVC repository. Outbound HTTPS only, to GitHub's own hosts,
 * every redirect checked. With no token it reads the public release pages (no API rate limit, so a shared office
 * address is not a problem). With a token (for a private repository) it uses the API, and the token is only ever
 * sent to api.github.com, never to the download host a redirect points at.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import { MANIFEST_FILE, SIGNATURE_FILE } from "./tree.js"

export const UPDATE_REPO = "breakmylegs/gatehouse"
const MAX_MANIFEST = 256 * 1024
const MAX_SIGNATURE = 1024
const IDLE_MS = 60_000

export interface LatestRelease {
  bytes: Buffer
  signature: string
}

export interface UpdateSource {
  /** Where updates come from, in words. */
  describe(): string
  /** The newest release's signed description, or undefined when the repository has no release yet. */
  latest(): Promise<LatestRelease | undefined>
  /** Streams one archive of a release into `file`, refusing it unless its size and sha256 match. */
  download(
    version: string,
    archive: string,
    expect: { size: number; sha256: string },
    file: string,
    onBytes: (n: number) => void,
  ): Promise<void>
}

export class UpdateError extends Error {}

const isGitHub = (u: URL) =>
  u.protocol === "https:" &&
  (u.hostname === "github.com" ||
    u.hostname === "api.github.com" ||
    u.hostname.endsWith(".githubusercontent.com"))

export interface GitHubSourceOptions {
  repo?: string
  /** A GitHub token, only needed while the repository is private. Read each time, never stored here. */
  token?: () => string | undefined
  /** Tests only: a local server standing in for github.com. Only that origin is then allowed. */
  base?: string
  /** Tests only: more local origins a redirect may lead to (a stand-in download host). */
  testOrigins?: string[]
  fetchImpl?: typeof fetch
}

export class GitHubSource implements UpdateSource {
  readonly #repo: string
  readonly #token: () => string | undefined
  readonly #base: URL | undefined
  readonly #testOrigins: string[]
  readonly #fetch: typeof fetch
  /** Asset download addresses by version, from the API (token mode only). */
  readonly #assets = new Map<string, Map<string, string>>()

  constructor(o: GitHubSourceOptions = {}) {
    this.#repo = o.repo ?? UPDATE_REPO
    this.#token = o.token ?? (() => undefined)
    this.#base = o.base ? new URL(o.base) : undefined
    this.#testOrigins = o.base ? (o.testOrigins ?? []) : []
    this.#fetch = o.fetchImpl ?? fetch
  }

  describe(): string {
    return `${this.#base ? this.#base.origin : "https://github.com"}/${this.#repo}/releases`
  }

  #web(p: string): string {
    return `${this.#base ? this.#base.origin : "https://github.com"}/${this.#repo}/${p}`
  }

  #api(p: string): string {
    return `${this.#base ? this.#base.origin + "/api" : "https://api.github.com"}/repos/${this.#repo}/${p}`
  }

  #allowed(u: URL): boolean {
    return this.#base
      ? u.origin === this.#base.origin || this.#testOrigins.includes(u.origin)
      : isGitHub(u)
  }

  /** GET with every redirect checked. The token goes only to the API host it was meant for. */
  async #get(url: string, accept: string, signal: AbortSignal): Promise<Response> {
    let u = new URL(url)
    const token = this.#token()
    const apiOrigin = new URL(this.#api("")).origin
    for (let hop = 0; hop < 6; hop++) {
      if (!this.#allowed(u)) throw new UpdateError(`Refused to fetch from ${u.origin}: not GitHub.`)
      const headers: Record<string, string> = { accept, "user-agent": "JCVC-updater" }
      if (token && u.origin === apiOrigin) headers.authorization = `Bearer ${token}`
      const res = await this.#fetch(u, { headers, redirect: "manual", signal })
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location")
        if (!loc) throw new UpdateError("GitHub sent a redirect without an address.")
        u = new URL(loc, u)
        continue
      }
      return res
    }
    throw new UpdateError("Too many redirects from GitHub.")
  }

  async #small(url: string, accept: string, max: number): Promise<Buffer | undefined> {
    const res = await this.#get(url, accept, AbortSignal.timeout(20_000))
    if (res.status === 404) return undefined
    if (res.status === 401 || res.status === 403)
      throw new UpdateError(
        `GitHub refused the request (${res.status}). Check the token in Settings.`,
      )
    if (!res.ok) throw new UpdateError(`GitHub answered ${res.status}.`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > max) throw new UpdateError("The update's description is too large.")
    return buf
  }

  async latest(): Promise<LatestRelease | undefined> {
    if (this.#token()) return this.#latestApi()
    const bytes = await this.#small(
      this.#web(`releases/latest/download/${MANIFEST_FILE}`),
      "application/octet-stream",
      MAX_MANIFEST,
    )
    if (!bytes) return undefined
    // The signature is read from the same release the description names, so a release published in between
    // cannot pair one release's description with another's signature.
    const version = versionIn(bytes)
    const sig = await this.#small(
      this.#web(`releases/download/v${version}/${SIGNATURE_FILE}`),
      "application/octet-stream",
      MAX_SIGNATURE,
    )
    if (!sig) throw new UpdateError(`Release ${version} has no signature, so it was refused.`)
    return { bytes, signature: sig.toString("utf8") }
  }

  async #latestApi(): Promise<LatestRelease | undefined> {
    const meta = await this.#small(
      this.#api("releases/latest"),
      "application/vnd.github+json",
      4 * 1024 * 1024,
    )
    if (!meta) return undefined
    const rel = JSON.parse(meta.toString("utf8")) as {
      tag_name?: string
      assets?: Array<{ name?: string; url?: string }>
    }
    const assets = new Map<string, string>()
    for (const a of rel.assets ?? []) if (a.name && a.url) assets.set(a.name, a.url)
    const m = assets.get(MANIFEST_FILE)
    const s = assets.get(SIGNATURE_FILE)
    if (!m || !s)
      throw new UpdateError(
        `Release ${rel.tag_name ?? ""} has no ${!m ? MANIFEST_FILE : SIGNATURE_FILE}.`,
      )
    const bytes = await this.#small(m, "application/octet-stream", MAX_MANIFEST)
    const sig = await this.#small(s, "application/octet-stream", MAX_SIGNATURE)
    if (!bytes || !sig) throw new UpdateError("A release file disappeared while it was read.")
    this.#assets.set(versionIn(bytes), assets)
    return { bytes, signature: sig.toString("utf8") }
  }

  async download(
    version: string,
    archive: string,
    expect: { size: number; sha256: string },
    file: string,
    onBytes: (n: number) => void,
  ): Promise<void> {
    const url = this.#token()
      ? this.#assets.get(version)?.get(archive)
      : this.#web(`releases/download/v${version}/${archive}`)
    if (!url)
      throw new UpdateError(`Release ${version} has no ${archive}. Check for updates again.`)
    const ctl = new AbortController()
    let idle = setTimeout(() => ctl.abort(), IDLE_MS)
    const tmp = `${file}.part`
    try {
      const res = await this.#get(url, "application/octet-stream", ctl.signal)
      if (!res.ok || !res.body)
        throw new UpdateError(`Downloading ${archive} failed: GitHub answered ${res.status}.`)
      const declared = Number(res.headers.get("content-length") ?? "NaN")
      if (Number.isFinite(declared) && declared !== expect.size)
        throw new UpdateError(`${archive} is not the size the release says. It was refused.`)
      const h = crypto.createHash("sha256")
      const out = fs.createWriteStream(tmp)
      let n = 0
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          clearTimeout(idle)
          idle = setTimeout(() => ctl.abort(), IDLE_MS)
          n += chunk.length
          if (n > expect.size)
            throw new UpdateError(`${archive} is larger than the release says. It was refused.`)
          h.update(chunk)
          if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()))
          onBytes(chunk.length)
        }
      } finally {
        await new Promise<void>((r) => out.end(r))
      }
      if (n !== expect.size || h.digest("hex") !== expect.sha256)
        throw new UpdateError(`${archive} does not match the signed release. It was refused.`)
      fs.renameSync(tmp, file)
    } catch (e) {
      fs.rmSync(tmp, { force: true })
      if (ctl.signal.aborted)
        throw new UpdateError(`Downloading ${archive} stalled for a minute and was stopped.`)
      throw e
    } finally {
      clearTimeout(idle)
    }
  }
}

/** The version a description names, read before the signature is checked only to find the matching signature. */
function versionIn(bytes: Buffer): string {
  try {
    const v = (JSON.parse(bytes.toString("utf8")) as { version?: unknown }).version
    if (typeof v === "string" && /^[0-9A-Za-z.+-]{1,60}$/.test(v)) return v
  } catch {
    // fall through
  }
  throw new UpdateError("The update's description could not be read.")
}
