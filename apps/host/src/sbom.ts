/**
 * D-056, an SBOM per change (Frontier build, Wave 2): what a change does to the project's dependencies, as a
 * CycloneDX 1.6 JSON document, made by Codehouse itself from the lockfiles before and after. No tool runs and
 * nothing is fetched: each lockfile is read as text. A component the change adds, changes or removes is listed, and
 * which of the three it is is a property (CycloneDX has no diff document of its own).
 */
import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { parse as parseYaml } from "yaml"

export interface LockedPackage {
  ecosystem: "npm" | "pypi" | "cargo" | "golang" | "composer" | "nuget" | "gem"
  name: string
  version: string
  /** The lockfile's integrity or checksum, where it has one. */
  hash?: string
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown) => (typeof v === "string" ? v : undefined)

/** npm's package-lock.json and npm-shrinkwrap.json, versions 1 to 3. */
function npmLock(text: string): LockedPackage[] {
  const j = obj(JSON.parse(text))
  const out: LockedPackage[] = []
  const packages = obj(j.packages)
  if (Object.keys(packages).length) {
    for (const [key, v] of Object.entries(packages)) {
      const p = obj(v)
      // The project itself, and links to the workspace's own packages, are not dependencies.
      if (!key || p.link === true) continue
      const name = str(p.name) ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length)
      const version = str(p.version)
      if (name && version) out.push({ ecosystem: "npm", name, version, ...(str(p.integrity) ? { hash: str(p.integrity) } : {}) })
    }
    return out
  }
  const walk = (deps: unknown) => {
    for (const [name, v] of Object.entries(obj(deps))) {
      const p = obj(v)
      const version = str(p.version)
      if (version) out.push({ ecosystem: "npm", name, version, ...(str(p.integrity) ? { hash: str(p.integrity) } : {}) })
      walk(p.dependencies)
    }
  }
  walk(j.dependencies)
  return out
}

/** yarn.lock, classic (v1) and Berry: a block per range, with its version and checksum. */
function yarnLock(text: string): LockedPackage[] {
  const out: LockedPackage[] = []
  for (const block of text.split(/\r?\n(?=\S)/)) {
    const head = block.split(/\r?\n/)[0] ?? ""
    if (!head.endsWith(":") || head.startsWith("#") || head.startsWith("__metadata")) continue
    const first = head.replace(/:$/, "").split(",")[0]!.trim().replace(/^"|"$/g, "")
    const at = first.lastIndexOf("@")
    const name = at > 0 ? first.slice(0, at) : first
    const version = /^\s+version:?\s+"?([^"\s]+)"?/m.exec(block)?.[1]
    if (!name || !version) continue
    // Berry lists the workspace's own packages too, resolved to workspace:.
    if (/^\s+resolution:\s+"?[^"]*@workspace:/m.test(block)) continue
    const hash = /^\s+(?:integrity|checksum):?\s+"?([^"\s]+)"?/m.exec(block)?.[1]
    out.push({ ecosystem: "npm", name: name.replace(/@npm:.*$/, ""), version, ...(hash ? { hash } : {}) })
  }
  return out
}

/** pnpm-lock.yaml: packages keyed /name@version (v6) or name@version (v9), with their integrity. */
function pnpmLock(text: string): LockedPackage[] {
  const y = obj(parseYaml(text))
  const out: LockedPackage[] = []
  for (const [key, v] of Object.entries(obj(y.packages))) {
    const k = key.replace(/^\//, "").replace(/\(.*$/, "")
    const at = k.lastIndexOf("@")
    if (at <= 0) continue
    const hash = str(obj(obj(v).resolution).integrity)
    out.push({ ecosystem: "npm", name: k.slice(0, at), version: k.slice(at + 1), ...(hash ? { hash } : {}) })
  }
  return out
}

/** Cargo.lock, poetry.lock and uv.lock: [[package]] tables with name and version. */
function packageTables(text: string, ecosystem: LockedPackage["ecosystem"]): LockedPackage[] {
  const out: LockedPackage[] = []
  for (const table of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const body = table.split(/^\[(?!\[package\])/m)[0] ?? table
    const name = /^name\s*=\s*"([^"]+)"/m.exec(body)?.[1]
    const version = /^version\s*=\s*"([^"]+)"/m.exec(body)?.[1]
    const hash = /^checksum\s*=\s*"([^"]+)"/m.exec(body)?.[1]
    if (name && version) out.push({ ecosystem, name, version, ...(hash ? { hash } : {}) })
  }
  return out
}

/** go.sum: a module and version per line; the go.mod-only lines are the same module. */
function goSum(text: string): LockedPackage[] {
  const seen = new Map<string, LockedPackage>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+)\s+(v[^\s/]+)(\/go\.mod)?\s+(\S+)$/.exec(line.trim())
    if (!m) continue
    const key = `${m[1]}@${m[2]}`
    if (!m[3] || !seen.has(key)) seen.set(key, { ecosystem: "golang", name: m[1]!, version: m[2]!, hash: m[4]! })
  }
  return [...seen.values()]
}

function composerLock(text: string): LockedPackage[] {
  const j = obj(JSON.parse(text))
  return [...(Array.isArray(j.packages) ? j.packages : []), ...(Array.isArray(j["packages-dev"]) ? j["packages-dev"] : [])]
    .map((p) => obj(p))
    .filter((p) => str(p.name) && str(p.version))
    .map((p) => ({ ecosystem: "composer" as const, name: str(p.name)!, version: str(p.version)!.replace(/^v/, "") }))
}

/** NuGet's packages.lock.json: each target framework's resolved packages, once each. */
function nugetLock(text: string): LockedPackage[] {
  const seen = new Map<string, LockedPackage>()
  for (const tfm of Object.values(obj(obj(JSON.parse(text)).dependencies)))
    for (const [name, v] of Object.entries(obj(tfm))) {
      const p = obj(v)
      const version = str(p.resolved)
      if (version && p.type !== "Project")
        seen.set(`${name}@${version}`, { ecosystem: "nuget", name, version, ...(str(p.contentHash) ? { hash: str(p.contentHash) } : {}) })
    }
  return [...seen.values()]
}

function pipfileLock(text: string): LockedPackage[] {
  const j = obj(JSON.parse(text))
  const out: LockedPackage[] = []
  for (const section of ["default", "develop"])
    for (const [name, v] of Object.entries(obj(j[section]))) {
      const version = str(obj(v).version)?.replace(/^==/, "")
      if (version) out.push({ ecosystem: "pypi", name, version })
    }
  return out
}

/** Gemfile.lock: the specs under GEM, four spaces in. */
function gemfileLock(text: string): LockedPackage[] {
  const out: LockedPackage[] = []
  for (const m of text.matchAll(/^ {4}([A-Za-z0-9_.-]+) \(([^)\s]+)\)$/gm)) out.push({ ecosystem: "gem", name: m[1]!, version: m[2]! })
  return out
}

/** The packages a lockfile pins, or undefined for a file that is not a lockfile Codehouse reads. Never throws. */
export function lockedPackages(file: string, text: string): LockedPackage[] | undefined {
  const base = path.basename(file.replace(/\\/g, "/")).toLowerCase()
  try {
    switch (base) {
      case "package-lock.json":
      case "npm-shrinkwrap.json":
        return npmLock(text)
      case "yarn.lock":
        return yarnLock(text)
      case "pnpm-lock.yaml":
        return pnpmLock(text)
      case "cargo.lock":
        return packageTables(text, "cargo")
      case "poetry.lock":
      case "uv.lock":
        return packageTables(text, "pypi")
      case "go.sum":
        return goSum(text)
      case "composer.lock":
        return composerLock(text)
      case "packages.lock.json":
        return nugetLock(text)
      case "pipfile.lock":
        return pipfileLock(text)
      case "gemfile.lock":
        return gemfileLock(text)
      default:
        return undefined
    }
  } catch {
    // A lockfile that does not parse (half written, or not what its name says) lists nothing.
    return []
  }
}

/** The package URL (purl) of a package. */
export function purlOf(p: LockedPackage): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%2F/g, "/")
  if (p.ecosystem === "npm" && p.name.startsWith("@")) {
    const [scope, name] = p.name.split("/")
    return `pkg:npm/${encodeURIComponent(scope!)}/${enc(name ?? "")}@${enc(p.version)}`
  }
  const name = p.ecosystem === "pypi" ? p.name.toLowerCase().replace(/[-_.]+/g, "-") : p.name
  return `pkg:${p.ecosystem}/${enc(name)}@${enc(p.version)}`
}

export type ChangeKind = "added" | "changed" | "removed"

export interface DependencyChange {
  kind: ChangeKind
  lockfile: string
  package: LockedPackage
  previousVersion?: string
}

/** What one lockfile's change does, package by package. A package name with several versions counts each. */
export function lockfileChanges(file: string, before: string | undefined, after: string | undefined): DependencyChange[] {
  const was = lockedPackages(file, before ?? "") ?? []
  const now = lockedPackages(file, after ?? "") ?? []
  const key = (p: LockedPackage) => `${p.ecosystem}:${p.name}`
  const versions = (list: LockedPackage[]) => {
    const m = new Map<string, Map<string, LockedPackage>>()
    for (const p of list) {
      const k = key(p)
      if (!m.has(k)) m.set(k, new Map())
      m.get(k)!.set(p.version, p)
    }
    return m
  }
  const a = versions(was)
  const b = versions(now)
  const out: DependencyChange[] = []
  for (const [k, vs] of b) {
    const old = a.get(k)
    const gone = old ? [...old.keys()].filter((v) => !vs.has(v)) : []
    for (const [v, p] of vs) {
      if (old?.has(v)) continue
      const previousVersion = gone.shift()
      out.push({ kind: previousVersion ? "changed" : "added", lockfile: file, package: p, ...(previousVersion ? { previousVersion } : {}) })
    }
    // What is left of the old versions was dropped.
    for (const v of gone) out.push({ kind: "removed", lockfile: file, package: old!.get(v)! })
  }
  for (const [k, vs] of a) if (!b.has(k)) for (const p of vs.values()) out.push({ kind: "removed", lockfile: file, package: p })
  return out
}

/** The sri prefixes CycloneDX names, and the hex length of a whole digest of each. */
const HASH_ALG: Array<[RegExp, string, number]> = [
  [/^sha512-/, "SHA-512", 128],
  [/^sha384-/, "SHA-384", 96],
  [/^sha256-/, "SHA-256", 64],
  [/^sha1-/, "SHA-1", 40],
]

/** A lockfile's sri integrity as a CycloneDX hash (hex), where it is one of the algorithms CycloneDX names. */
function hashOf(h: string | undefined): Array<{ alg: string; content: string }> {
  if (!h) return []
  const sri = HASH_ALG.find(([re]) => re.test(h))
  if (sri) {
    try {
      const content = Buffer.from(h.slice(h.indexOf("-") + 1), "base64").toString("hex")
      // Only a whole digest: anything else is not the hash it says it is.
      return content.length === sri[2] ? [{ alg: sri[1], content }] : []
    } catch {
      return []
    }
  }
  if (/^[0-9a-f]{64}$/i.test(h)) return [{ alg: "SHA-256", content: h.toLowerCase() }]
  return []
}

/**
 * The CycloneDX 1.6 document for a change: each added, changed or removed component, with codehouse:change and, for a
 * changed one, codehouse:previousVersion; the lockfiles it came from in the metadata.
 */
export function sbomDiff(
  changes: DependencyChange[],
  o: { project: string; version: string; now?: () => Date; serial?: string; describe?: string },
): Record<string, unknown> {
  const components = changes.map((c) => {
    const purl = purlOf(c.package)
    const hashes = hashOf(c.package.hash)
    return {
      type: "library",
      "bom-ref": `${c.kind}:${c.lockfile}:${purl}`,
      name: c.package.name,
      version: c.package.version,
      purl,
      ...(hashes.length ? { hashes } : {}),
      properties: [
        { name: "codehouse:change", value: c.kind },
        { name: "codehouse:lockfile", value: c.lockfile },
        ...(c.previousVersion ? [{ name: "codehouse:previousVersion", value: c.previousVersion }] : []),
      ],
    }
  })
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${o.serial ?? randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: (o.now ?? (() => new Date()))().toISOString().replace(/\.\d{3}Z$/, "Z"),
      tools: { components: [{ type: "application", name: "Codehouse", version: o.version }] },
      component: { type: "application", "bom-ref": "project", name: o.project },
      properties: [
        { name: "codehouse:kind", value: "dependency change" },
        ...(o.describe ? [{ name: "codehouse:change-of", value: o.describe }] : []),
        ...[...new Set(changes.map((c) => c.lockfile))].map((f) => ({ name: "codehouse:lockfile", value: f })),
      ],
    },
    components,
  }
}

/** The document's sha256, for linking it from evidence (D-003). */
export const sbomHash = (bom: Record<string, unknown>) =>
  createHash("sha256").update(JSON.stringify(bom)).digest("hex")
