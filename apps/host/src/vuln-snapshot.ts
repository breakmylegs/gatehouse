/**
 * D-057, an offline vulnerability snapshot (Frontier build, Wave 2, the safe variant). Codehouse ships no snapshot and
 * fetches nothing: a file of OSV advisories (`osv-snapshot.json`, OSV's own format, as a JSON array or { vulns: [] })
 * is placed in the managed folder (C:\ProgramData\Codehouse\managed, which only an administrator can change) with its
 * signature (`osv-snapshot.sig`, ECDSA P-256 over the file's bytes, SHA-256, base64, IEEE P1363 or DER) and the
 * signer's public key (`osv-key.json`, a JWK). The owner decided on 9 Nov that IT is never asked, so whoever looks after
 * this computer signs it; the folder's permissions are what make the key trusted.
 *
 * A dependency version a change adds or upgrades to that the snapshot names makes the session's next commit go to a
 * person, with the advisory ids, and Extreme approval never approves it. A snapshot that is unsigned, whose signature
 * does not verify, or that cannot be read is not used at all (fail closed: nothing is matched against it) and Doctor
 * says so. It can only tighten: a dependency the snapshot does not name is decided as before.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { isLockfile } from "@gatehouse/policy"
import { commitAdditions, git, makesCommit, type Git } from "./commit-scan.js"
import { addedLines } from "./sast.js"
import { lockfileChanges, type DependencyChange, type LockedPackage } from "./sbom.js"

export const VULN_RULE = "vulnerable-dependency"

export type SnapshotState =
  | { state: "none" }
  | { state: "ok"; advisories: number; signedAt?: string }
  | { state: "refused"; why: string }

interface Osv {
  id: string
  aliases?: string[]
  affected?: Array<{
    package?: { ecosystem?: string; name?: string }
    versions?: string[]
    ranges?: Array<{ type?: string; events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }> }>
  }>
}

/** OSV's ecosystem names, by the ones the lockfiles give. */
const ECOSYSTEM: Record<LockedPackage["ecosystem"], string> = {
  npm: "npm",
  pypi: "PyPI",
  cargo: "crates.io",
  golang: "Go",
  composer: "Packagist",
  nuget: "NuGet",
  gem: "RubyGems",
}

/** Compares dotted versions part by part, numbers as numbers; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [main, pre] = v.replace(/^v/, "").split("-", 2)
    return { parts: main!.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)), pre }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const p = x.parts[i] ?? 0
    const q = y.parts[i] ?? 0
    if (p === q) continue
    if (typeof p === "number" && typeof q === "number") return p - q
    return String(p).localeCompare(String(q))
  }
  if (x.pre && !y.pre) return -1
  if (!x.pre && y.pre) return 1
  return (x.pre ?? "").localeCompare(y.pre ?? "")
}

function affects(a: NonNullable<Osv["affected"]>[number], version: string): boolean {
  if (a.versions?.includes(version)) return true
  for (const r of a.ranges ?? []) {
    if (r.type !== "SEMVER" && r.type !== "ECOSYSTEM") continue
    let inside = false
    for (const e of r.events ?? []) {
      if (e.introduced !== undefined) inside = e.introduced === "0" || compareVersions(version, e.introduced) >= 0
      if (inside && e.fixed !== undefined && compareVersions(version, e.fixed) >= 0) inside = false
      if (inside && e.last_affected !== undefined && compareVersions(version, e.last_affected) > 0) inside = false
    }
    if (inside) return true
  }
  return false
}

export interface VulnMatch {
  name: string
  version: string
  ecosystem: string
  ids: string[]
  lockfile: string
}

/** The snapshot in the managed folder, read again when its files change. */
export class VulnSnapshot {
  readonly #dir: string
  #seen = ""
  #state: SnapshotState = { state: "none" }
  #index = new Map<string, Osv[]>()

  constructor(managedDir: string) {
    this.#dir = managedDir
  }

  #files() {
    return { data: path.join(this.#dir, "osv-snapshot.json"), sig: path.join(this.#dir, "osv-snapshot.sig"), key: path.join(this.#dir, "osv-key.json") }
  }

  /** Loads it when it changed; never throws. */
  #load(): void {
    const f = this.#files()
    const stamp = [f.data, f.sig, f.key].map((p) => {
      try {
        const s = fs.statSync(p)
        return `${s.size}:${s.mtimeMs}`
      } catch {
        return "-"
      }
    }).join("|")
    if (stamp === this.#seen) return
    this.#seen = stamp
    this.#index = new Map()
    if (!fs.existsSync(f.data)) return void (this.#state = { state: "none" })
    const refuse = (why: string) => void (this.#state = { state: "refused", why })
    if (!fs.existsSync(f.sig)) return refuse("it has no signature (osv-snapshot.sig)")
    if (!fs.existsSync(f.key)) return refuse("the key to check it with (osv-key.json) is missing")
    let bytes: Buffer
    try {
      bytes = fs.readFileSync(f.data)
      const key = crypto.createPublicKey({ key: JSON.parse(fs.readFileSync(f.key, "utf8")) as crypto.JsonWebKey, format: "jwk" })
      const sig = Buffer.from(fs.readFileSync(f.sig, "utf8").trim(), "base64")
      const ok =
        crypto.verify("sha256", bytes, { key, dsaEncoding: "ieee-p1363" }, sig) ||
        crypto.verify("sha256", bytes, { key, dsaEncoding: "der" }, sig)
      if (!ok) return refuse("its signature does not verify, so it was changed or signed with another key")
    } catch {
      return refuse("its signature or key could not be read")
    }
    let list: Osv[]
    try {
      const j = JSON.parse(bytes.toString("utf8")) as Osv[] | { vulns?: Osv[]; generated?: string }
      list = Array.isArray(j) ? j : (j.vulns ?? [])
      if (!Array.isArray(list)) throw new Error("shape")
    } catch {
      return refuse("it is not OSV advisories")
    }
    for (const v of list)
      for (const a of v.affected ?? []) {
        const k = `${a.package?.ecosystem ?? ""}:${a.package?.name ?? ""}`.toLowerCase()
        if (!this.#index.has(k)) this.#index.set(k, [])
        this.#index.get(k)!.push(v)
      }
    this.#state = { state: "ok", advisories: list.length }
  }

  status(): SnapshotState {
    this.#load()
    return this.#state
  }

  /** The added or upgraded versions the snapshot names. Nothing when it is missing or refused. */
  matches(changes: DependencyChange[]): VulnMatch[] {
    this.#load()
    if (this.#state.state !== "ok") return []
    const out: VulnMatch[] = []
    for (const c of changes) {
      if (c.kind === "removed") continue
      const eco = ECOSYSTEM[c.package.ecosystem]
      const name = c.package.ecosystem === "pypi" ? c.package.name.toLowerCase().replace(/[-_.]+/g, "-") : c.package.name
      const ids = (this.#index.get(`${eco}:${name}`.toLowerCase()) ?? [])
        .filter((v) => (v.affected ?? []).some((a) => `${a.package?.ecosystem}:${a.package?.name}`.toLowerCase() === `${eco}:${name}`.toLowerCase() && affects(a, c.package.version)))
        .map((v) => v.id)
      if (ids.length) out.push({ name: c.package.name, version: c.package.version, ecosystem: eco, ids: [...new Set(ids)], lockfile: c.lockfile })
    }
    return out
  }
}

/** Why the commit waits for you. */
export function vulnReason(found: VulnMatch[]): string {
  const list = found
    .slice(0, 5)
    .map((m) => `${m.name} ${m.version} (${m.ids.slice(0, 3).join(", ")})`)
    .join("; ")
  return `This commit adds dependency versions your vulnerability snapshot lists: ${list}${found.length > 5 ? `; and ${found.length - 5} more` : ""}. Upgrade them, or look at the advisories before it is committed.`
}

/**
 * What a session's commit would add to its lockfiles, matched against the snapshot: each lockfile as it is in HEAD and
 * as it is now. Without a usable snapshot nothing is read. Rejects when a lockfile cannot be read (fail closed).
 */
export class VulnCommitGuard {
  readonly #snapshot: VulnSnapshot
  readonly #run: Git
  readonly #cache = new Map<string, { at: number; found: Promise<VulnMatch[]> }>()

  constructor(snapshot: VulnSnapshot, run: Git = git) {
    this.#snapshot = snapshot
    this.#run = run
  }

  matches(cwd: string, command: string): Promise<VulnMatch[]> {
    if (this.#snapshot.status().state !== "ok" || !makesCommit("Bash", { command })) return Promise.resolve([])
    const key = `${cwd}\n${command}`
    const hit = this.#cache.get(key)
    if (hit && Date.now() - hit.at < 10_000) return hit.found
    const found = this.#read(cwd, command)
    this.#cache.set(key, { at: Date.now(), found })
    found.catch(() => this.#cache.delete(key))
    return found
  }

  async #read(cwd: string, command: string): Promise<VulnMatch[]> {
    const { diff, untracked } = await commitAdditions(cwd, command, this.#run)
    const top = (await this.#run(cwd, ["rev-parse", "--show-toplevel"])).trim() || cwd
    const locks = [
      ...[...addedLines(diff).keys()].map((rel) => ({ rel, abs: path.join(top, rel), fromTop: true })),
      ...untracked.map((rel) => ({ rel, abs: path.join(cwd, rel), fromTop: false })),
    ].filter((f) => isLockfile(f.rel))
    const changes: DependencyChange[] = []
    for (const f of locks) {
      const after = fs.readFileSync(f.abs, "utf8")
      const before = f.fromTop ? await this.#run(top, ["show", `HEAD:${f.rel.replace(/\\/g, "/")}`]).catch(() => "") : ""
      changes.push(...lockfileChanges(f.rel, before, after))
    }
    return this.#snapshot.matches(changes)
  }
}
