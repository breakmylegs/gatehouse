/**
 * D-052, a multi-repo contract check (Frontier build). When D-046 finds that an edit removes exports from a library,
 * the other repositories on this computer that use that library are named: those beside it (its parent folder's other
 * folders, and any others the caller names) whose package.json depends on the library's package and whose files
 * import a removed name from it. Read only, and only when there is a break; at most 50 repositories and 3,000 files each.
 */
import fs from "node:fs"
import path from "node:path"

export interface ConsumerUse {
  file: string
  line: number
  name: string
}

export interface Consumer {
  repo: string
  uses: ConsumerUse[]
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", "dist-app"])
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/i
const MAX_REPOS = 50
const MAX_FILES = 3000
const MAX_SIZE = 1_000_000

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")

function packageOf(dir: string): { name?: string; deps: Set<string> } | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Record<string, unknown>
    const deps = new Set<string>()
    for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])
      for (const n of Object.keys((pkg[k] as Record<string, unknown> | undefined) ?? {})) deps.add(n)
    return { ...(typeof pkg.name === "string" ? { name: pkg.name } : {}), deps }
  } catch {
    return undefined
  }
}

function* sources(root: string): Generator<string> {
  let count = 0
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(p)
      } else if (SOURCE.test(e.name)) {
        if (++count > MAX_FILES) return
        yield p
      }
    }
  }
}

/** The names a file imports from the package, each with its line. */
export function importsFrom(text: string, pkg: string): ConsumerUse[] {
  const from = String.raw`["']${escape(pkg)}(?:\/[^"']*)?["']`
  const out: ConsumerUse[] = []
  const lineAt = (i: number) => text.slice(0, i).split("\n").length
  const named = (list: string, at: number) => {
    for (const part of list.split(",")) {
      const name = part.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0]!.trim()
      if (name) out.push({ file: "", line: lineAt(at), name })
    }
  }
  for (const m of text.matchAll(new RegExp(String.raw`import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*${from}`, "g"))) {
    if (m[1]) out.push({ file: "", line: lineAt(m.index), name: "default" })
    if (m[2]) named(m[2], m.index)
  }
  for (const m of text.matchAll(new RegExp(String.raw`(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*${from}\s*\)`, "g"))) named(m[1]!.replace(/:\s*\w+/g, ""), m.index)
  return out
}

/** The other repositories here that import a removed name from the library at `providerRoot`. */
export function consumersOf(providerRoot: string, removed: string[], known: string[] = []): Consumer[] {
  const provider = packageOf(providerRoot)
  if (!provider?.name || !removed.length) return []
  const self = path.resolve(providerRoot).toLowerCase()
  const parent = path.dirname(path.resolve(providerRoot))
  let siblings: string[] = []
  try {
    siblings = fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP.has(e.name))
      .map((e) => path.join(parent, e.name))
  } catch {
    siblings = []
  }
  const repos = [...new Map([...siblings, ...known].map((r) => [path.resolve(r).toLowerCase(), path.resolve(r)])).entries()]
    .filter(([k]) => k !== self)
    .map(([, r]) => r)
    .slice(0, MAX_REPOS)
  const wanted = new Set(removed)
  const out: Consumer[] = []
  for (const repo of repos) {
    if (!packageOf(repo)?.deps.has(provider.name)) continue
    const uses: ConsumerUse[] = []
    for (const file of sources(repo)) {
      let text: string
      try {
        if (fs.statSync(file).size > MAX_SIZE) continue
        text = fs.readFileSync(file, "utf8")
      } catch {
        continue
      }
      if (!text.includes(provider.name)) continue
      for (const u of importsFrom(text, provider.name)) if (wanted.has(u.name)) uses.push({ ...u, file: path.relative(repo, file).replace(/\\/g, "/") })
    }
    if (uses.length) out.push({ repo: path.basename(repo), uses })
  }
  return out
}

/** The consumers, in words, for the reason a break is asked about. */
export function consumersWords(cs: Consumer[]): string {
  if (!cs.length) return ""
  const each = cs
    .slice(0, 10)
    .map((c) => `- ${c.repo}: ${c.uses.slice(0, 5).map((u) => `${u.name} in ${u.file}:${u.line}`).join(", ")}${c.uses.length > 5 ? `, and ${c.uses.length - 5} more` : ""}`)
  return `\nUsed by ${cs.length === 1 ? "another repository" : `${cs.length} other repositories`} on this computer:\n${each.join("\n")}`
}
