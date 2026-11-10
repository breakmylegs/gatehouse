/**
 * D-053, dependency admission control (Frontier build, Wave 1; the safe variant, with no network). A change that adds
 * a dependency whose exact name the project does not already use (in a lockfile or a manifest) or the owner has not
 * approved goes to a person, and the card says how close the name is to a popular one, the usual sign of a typo or a
 * squat. A name language models are known to invent is denied while the project does not use it.
 *
 * It reads install commands (npm, pnpm, yarn, bun, pip, uv, poetry, pipenv, dotnet, nuget, cargo, go) and edits to
 * manifests (package.json, requirements files, pyproject.toml, .csproj, Cargo.toml, go.mod). Nothing is fetched.
 */
import fs from "node:fs"
import path from "node:path"
import { KNOWN_HALLUCINATIONS, POPULAR, type Ecosystem } from "./dependency-lists.js"

export interface AddedDependency {
  ecosystem: Ecosystem
  name: string
  /** "the command" or the manifest it was added to. */
  via: string
}

export interface DependencyFinding {
  outcome: "deny" | "escalate"
  ruleId: "dependency-hallucinated" | "dependency-new"
  reason: string
  risk: number
}

const norm = (eco: Ecosystem, n: string) => (eco === "pypi" ? n.toLowerCase().replace(/[-_.]+/g, "-") : eco === "nuget" ? n.toLowerCase() : n)

/** The name a spec names: "lodash@4" is lodash, "@scope/x@1" is @scope/x, "requests==2.1" is requests. */
function nameOf(eco: Ecosystem, spec: string): string | undefined {
  const s = spec.trim()
  if (!s || s.startsWith("-") || /^[.~/\\]|^[a-zA-Z]:|:\/\/|^git\+|\.(tgz|tar\.gz|whl|zip)$/i.test(s)) return undefined
  if (eco === "npm") {
    const m = /^(@[^/@\s]+\/[^@\s]+|[^@\s]+)(?:@.*)?$/.exec(s)
    return m?.[1]
  }
  if (eco === "pypi") return /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(s)?.[1]
  if (eco === "go") return s.split("@")[0]
  return /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(s)?.[1]
}

/** The words of each command of a shell line, quotes taken off. */
const commandsOf = (line: string): string[][] =>
  line
    .split(/&&|\|\||[;|\n]/)
    .map((p) => [...p.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? ""))
    .filter((w) => w.length > 0)

/** The dependencies an install command adds, by name. */
export function fromCommand(command: string): AddedDependency[] {
  const out: AddedDependency[] = []
  const take = (eco: Ecosystem, specs: string[]) => {
    for (const s of specs) {
      const n = nameOf(eco, s)
      if (n) out.push({ ecosystem: eco, name: n, via: "the command" })
    }
  }
  for (const w of commandsOf(command)) {
    const lw = w.map((x) => x.toLowerCase())
    const args = (from: number) => {
      // Skip a flag's value where the flag takes one.
      const r: string[] = []
      for (let i = from; i < w.length; i++) {
        const a = w[i]!
        if (/^(-r|--requirement|-c|--constraint|-e|--editable|--index-url|-i|--extra-index-url|--registry|--source|-s|--version|-v|--project|-p|--framework|-f)$/i.test(a)) {
          i++
          continue
        }
        r.push(a)
      }
      return r
    }
    const [a, b, c] = lw
    if ((a === "npm" || a === "pnpm" || a === "bun") && ["install", "i", "add", "isntall", "in"].includes(b ?? "")) take("npm", args(2))
    else if (a === "yarn" && (b === "add" || b === "global")) take("npm", args(b === "global" ? 3 : 2))
    else if ((a === "pip" || a === "pip3") && b === "install") take("pypi", args(2))
    else if ((a === "python" || a === "python3" || a === "py") && b === "-m" && c === "pip" && lw[3] === "install") take("pypi", args(4))
    else if (a === "uv" && b === "pip" && c === "install") take("pypi", args(3))
    else if ((a === "uv" || a === "poetry") && b === "add") take("pypi", args(2))
    else if (a === "pipenv" && b === "install") take("pypi", args(2))
    else if (a === "dotnet" && b === "add" && lw.includes("package")) take("nuget", args(lw.indexOf("package") + 1).slice(0, 1))
    else if ((a === "nuget" && b === "install") || a === "install-package") take("nuget", args(a === "nuget" ? 2 : 1).slice(0, 1))
    else if (a === "cargo" && (b === "add" || b === "install")) take("cargo", args(2))
    else if (a === "go" && (b === "get" || b === "install")) take("go", args(2))
  }
  return out
}

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]

/** Names in a package.json's dependency sections. */
function packageJsonDeps(text: string): Set<string> | undefined {
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const out = new Set<string>()
    for (const s of DEP_SECTIONS) for (const k of Object.keys((j[s] as Record<string, unknown>) ?? {})) out.add(k)
    return out
  } catch {
    return undefined
  }
}

/** Names in a manifest's text, by its kind, read line by line (works on a whole file or an edit's fragment). */
function manifestNames(file: string, text: string): Array<{ eco: Ecosystem; name: string }> {
  const base = path.basename(file).toLowerCase()
  const out: Array<{ eco: Ecosystem; name: string }> = []
  const lines = text.split(/\r?\n/)
  if (base === "package.json") {
    const whole = packageJsonDeps(text)
    if (whole) return [...whole].map((name) => ({ eco: "npm" as const, name }))
    // A fragment: "name": "version-ish" lines.
    for (const l of lines) {
      const m = /^\s*"(@?[^"\s]+)"\s*:\s*"((?:\^|~|>|<|=|\d|\*|latest|next|npm:|workspace:|file:|link:|git|github:|https?:)[^"]*)"/.exec(l)
      if (m && !["version", "node", "npm", "main", "type", "license"].includes(m[1]!)) out.push({ eco: "npm", name: m[1]! })
    }
    return out
  }
  if (/^requirements.*\.(txt|in)$/.test(base) || base === "constraints.txt") {
    for (const l of lines) {
      const n = nameOf("pypi", l.replace(/#.*/, ""))
      if (n && !l.trim().startsWith("-")) out.push({ eco: "pypi", name: n })
    }
    return out
  }
  if (base === "pyproject.toml" || base === "cargo.toml") {
    const eco: Ecosystem = base === "cargo.toml" ? "cargo" : "pypi"
    for (const l of lines) {
      const q = /^\s*"([A-Za-z0-9][A-Za-z0-9._\-[\]]*)\s*(?:[<>=!~^;].*)?"\s*,?\s*$/.exec(l)
      const kv = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(?:"[^"]*"|\{)/.exec(l)
      const n = q?.[1]?.replace(/\[.*$/, "") ?? kv?.[1]
      if (n && !["name", "version", "description", "python", "edition", "authors", "readme", "license", "requires-python"].includes(n.toLowerCase()))
        out.push({ eco, name: n })
    }
    return out
  }
  if (base.endsWith(".csproj") || base.endsWith(".fsproj") || base === "directory.packages.props") {
    for (const m of text.matchAll(/<Package(?:Reference|Version)\s+(?:Update|Include)="([^"]+)"/g)) out.push({ eco: "nuget", name: m[1]! })
    return out
  }
  if (base === "go.mod") {
    for (const l of lines) {
      const m = /^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v\d/.exec(l)
      if (m) out.push({ eco: "go", name: m[1]! })
    }
    return out
  }
  return out
}

/** What an edit of a manifest adds: names in the new text that were not in the old. */
export function fromManifestEdit(file: string, before: string, after: string): AddedDependency[] {
  const had = new Set(manifestNames(file, before).map((x) => `${x.eco}:${norm(x.eco, x.name)}`))
  const seen = new Set<string>()
  const out: AddedDependency[] = []
  for (const x of manifestNames(file, after)) {
    const key = `${x.eco}:${norm(x.eco, x.name)}`
    if (had.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ ecosystem: x.eco, name: x.name, via: path.basename(file) })
  }
  return out
}

const cache = new Map<string, { mtime: number; names: Set<string> }>()

/** A file's names, by its kind, cached by when it last changed. */
function namesIn(file: string, read: (f: string) => Set<string>): Set<string> {
  try {
    const st = fs.statSync(file)
    const hit = cache.get(file)
    if (hit && hit.mtime === st.mtimeMs) return hit.names
    const names = read(file)
    if (cache.size > 200) cache.clear()
    cache.set(file, { mtime: st.mtimeMs, names })
    return names
  } catch {
    return new Set()
  }
}

/** Every dependency the project already uses: its lockfiles and its manifests, at the project's root and the folder. */
export function knownDependencies(dirs: string[]): Set<string> {
  const known = new Set<string>()
  const add = (eco: Ecosystem, n: string) => known.add(`${eco}:${norm(eco, n)}`)
  for (const dir of [...new Set(dirs)]) {
    const f = (n: string) => path.join(dir, n)
    for (const n of namesIn(f("package-lock.json"), (p) => {
      const s = new Set<string>()
      try {
        const j = JSON.parse(fs.readFileSync(p, "utf8")) as { packages?: Record<string, unknown>; dependencies?: Record<string, unknown> }
        for (const k of Object.keys(j.packages ?? {})) {
          const m = /node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(k)
          if (m) s.add(m[1]!)
        }
        for (const k of Object.keys(j.dependencies ?? {})) s.add(k)
      } catch {
        // An unreadable lockfile adds nothing.
      }
      return s
    }))
      add("npm", n)
    for (const n of namesIn(f("yarn.lock"), (p) => new Set([...fs.readFileSync(p, "utf8").matchAll(/^"?((?:@[^@/\s"]+\/)?[^@\s",]+)@/gm)].map((m) => m[1]!))))
      add("npm", n)
    for (const n of namesIn(f("pnpm-lock.yaml"), (p) => new Set([...fs.readFileSync(p, "utf8").matchAll(/^\s+'?\/?((?:@[^@/\s']+\/)?[^@\s':/]+)@/gm)].map((m) => m[1]!))))
      add("npm", n)
    for (const lock of ["poetry.lock", "uv.lock", "Cargo.lock"])
      for (const n of namesIn(f(lock), (p) => new Set([...fs.readFileSync(p, "utf8").matchAll(/^name\s*=\s*"([^"]+)"/gm)].map((m) => m[1]!))))
        add(lock === "Cargo.lock" ? "cargo" : "pypi", n)
    for (const n of namesIn(f("Pipfile.lock"), (p) => {
      try {
        const j = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, Record<string, unknown>>
        return new Set([...Object.keys(j.default ?? {}), ...Object.keys(j.develop ?? {})])
      } catch {
        return new Set<string>()
      }
    }))
      add("pypi", n)
    for (const n of namesIn(f("packages.lock.json"), (p) => {
      try {
        const j = JSON.parse(fs.readFileSync(p, "utf8")) as { dependencies?: Record<string, Record<string, unknown>> }
        return new Set(Object.values(j.dependencies ?? {}).flatMap((x) => Object.keys(x)))
      } catch {
        return new Set<string>()
      }
    }))
      add("nuget", n)
    for (const n of namesIn(f("go.sum"), (p) => new Set([...fs.readFileSync(p, "utf8").matchAll(/^(\S+)\s+v/gm)].map((m) => m[1]!))))
      add("go", n)
    // Manifests count as already used too.
    let names: string[] = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      names = []
    }
    for (const n of names.filter((n) => /^(package\.json|requirements.*\.txt|pyproject\.toml|cargo\.toml|go\.mod|.*\.csproj|.*\.fsproj|directory\.packages\.props)$/i.test(n))) {
      try {
        for (const x of manifestNames(n, fs.readFileSync(f(n), "utf8"))) add(x.eco, x.name)
      } catch {
        // unreadable: nothing from it
      }
    }
  }
  return known
}

/** Edit distance (Damerau-Levenshtein, adjacent swaps count one), stopping above `max`. */
export function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
      best = Math.min(best, v)
    }
    if (best > max) return max + 1
  }
  return d[a.length]![b.length]!
}

/** The popular name this one is a letter or two from, if any (and not the name itself). */
export function nearPopular(eco: Ecosystem, name: string): { name: string; distance: number } | undefined {
  const n = name.toLowerCase()
  let best: { name: string; distance: number } | undefined
  for (const p of POPULAR[eco]) {
    if (p.toLowerCase() === n) return undefined
    const dd = distance(n, p.toLowerCase())
    if (dd <= 2 && (!best || dd < best.distance)) best = { name: p, distance: dd }
  }
  return best
}

/** What to do about each added dependency the project does not already use. Nothing for ones it does. */
export function admit(added: AddedDependency[], known: Set<string>, approved: ReadonlySet<string>): DependencyFinding[] {
  const out: DependencyFinding[] = []
  for (const d of added) {
    const key = `${d.ecosystem}:${norm(d.ecosystem, d.name)}`
    if (known.has(key) || approved.has(key)) continue
    const bad = KNOWN_HALLUCINATIONS.find((h) => h.ecosystem === d.ecosystem && norm(h.ecosystem, h.name) === norm(d.ecosystem, d.name))
    if (bad) {
      out.push({
        outcome: "deny",
        ruleId: "dependency-hallucinated",
        reason: `${d.name} (${d.ecosystem}) is a package name language models are known to invent, so someone may have registered it to catch them (${bad.source}, ${bad.date}). This project does not use it. Check the real name.`,
        risk: 100,
      })
      continue
    }
    const near = nearPopular(d.ecosystem, d.name)
    out.push({
      outcome: "escalate",
      ruleId: "dependency-new",
      reason: near
        ? `It adds ${d.name} (${d.ecosystem}, from ${d.via}), which this project does not use yet, and which is ${near.distance === 1 ? "one letter" : "two letters"} from the popular ${near.name}: check it is not a typo or a look-alike.`
        : `It adds ${d.name} (${d.ecosystem}, from ${d.via}), which this project does not use yet. Check the name is the package you mean.`,
      risk: near ? 80 : 72,
    })
  }
  return out
}
