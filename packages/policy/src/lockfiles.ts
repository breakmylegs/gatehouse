/**
 * D-054, the lockfile diff guard (Frontier build, Wave 1). A lockfile is written by the package manager, from the
 * manifest; an agent that edits one by hand changes what is installed without a manifest change to explain it. So an
 * agent's edit of a lockfile, by a file tool or the shell, goes to a person, and the reason names what in it matters
 * most: packages that gain an install script (with the script, where the package is installed here to read it), and
 * packages fetched from git or an address instead of the registry.
 */
import fs from "node:fs"
import path from "node:path"
import type { Segment } from "./segments.js"

export const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "poetry.lock",
  "uv.lock",
  "pipfile.lock",
  "packages.lock.json",
  "cargo.lock",
  "go.sum",
  "composer.lock",
  "gemfile.lock",
])

export const isLockfile = (p: string) => LOCKFILES.has(path.basename(p.replace(/\\/g, "/")).toLowerCase())

/** Hosts a lockfile normally fetches from. A source elsewhere, or from git, is named. */
const REGISTRIES =
  /^(?:https:\/\/(?:registry\.npmjs\.org|registry\.yarnpkg\.com|registry\.npmmirror\.com|npm\.pkg\.github\.com|files\.pythonhosted\.org|pypi\.org|api\.nuget\.org|static\.crates\.io|crates\.io|proxy\.golang\.org|sum\.golang\.org)\/)/

export interface LockfileFinding {
  ruleId: "lockfile-edited"
  reason: string
  risk: number
}

/** The lines the change adds: of a Write against the file as it is, or of an edit. */
function addedLines(before: string, after: string): string[] {
  const had = new Set(before.split(/\r?\n/).map((l) => l.trim()))
  return after.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !had.has(l))
}

/** The packages in an npm lockfile that gain hasInstallScript, by name. */
function newInstallScripts(before: string, after: string): string[] {
  const names: string[] = []
  // npm v2/v3 lockfiles: "node_modules/<name>": { ... "hasInstallScript": true ... }
  const scan = (text: string) => {
    const out = new Set<string>()
    for (const m of text.matchAll(/"node_modules\/((?:@[^/"]+\/)?[^/"]+)"\s*:\s*\{([^{}]*)\}/g))
      if (/"hasInstallScript"\s*:\s*true/.test(m[2]!)) out.add(m[1]!)
    return out
  }
  const had = scan(before)
  for (const n of scan(after)) if (!had.has(n)) names.push(n)
  // A fragment that only says hasInstallScript, without its package's key.
  if (!names.length && addedLines(before, after).some((l) => /"hasInstallScript"\s*:\s*true/.test(l))) names.push("a package")
  return names
}

/** The install script a package declares, if it is installed in node_modules here to read. */
function scriptOf(root: string, name: string): string | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")) as {
      scripts?: Record<string, string>
    }
    const s = j.scripts ?? {}
    const parts = ["preinstall", "install", "postinstall"].filter((k) => s[k]).map((k) => `${k}: ${s[k]}`)
    return parts.length ? parts.join("; ") : undefined
  } catch {
    return undefined
  }
}

/** A lockfile edit by a file tool: what it changes that matters. */
export function lockfileEdit(file: string, before: string, after: string, root: string): LockfileFinding | undefined {
  if (!isLockfile(file)) return undefined
  const name = path.basename(file)
  const parts: string[] = []
  const scripts = newInstallScripts(before, after)
  if (scripts.length) {
    const shown = scripts
      .slice(0, 3)
      .map((n) => {
        const s = n === "a package" ? undefined : scriptOf(root, n)
        return s ? `${n} (${s})` : `${n} (its script cannot be read here: the package is not installed)`
      })
      .join(", ")
    parts.push(`it gives ${scripts.length === 1 ? "a package an install script" : `${scripts.length} packages install scripts`}: ${shown}`)
  }
  const sources = [
    ...new Set(
      addedLines(before, after)
        .map((l) => {
          // "resolved": "x" (npm), resolved "x" (yarn 1), source = "x" (Cargo, Poetry), resolution: x (pnpm, yarn 2).
          const m = /"?(?:resolved|source|url|tarball|git)"?\s*[:=]?\s*"([^",\s]+)|"?(?:resolved|source|url|tarball|git)"?\s*[:=]\s*([^",\s]+)/.exec(l)
          return m?.[1] ?? m?.[2] ?? /\b(git\+[^\s",]+|github:[^\s",]+)/.exec(l)?.[1]
        })
        .filter((u): u is string => !!u && (/^(git\+|git:|github:|file:|link:)/.test(u) || (/^https?:\/\//.test(u) && !REGISTRIES.test(u)))),
    ),
  ]
  if (sources.length) parts.push(`it fetches from somewhere other than the registry: ${sources.slice(0, 3).join(", ")}`)
  return {
    ruleId: "lockfile-edited",
    reason: `It edits ${name} by hand, with no change to the manifest to explain it${parts.length ? `; ${parts.join("; ")}` : ""}. A lockfile is normally written by the package manager.`,
    risk: scripts.length || sources.length ? 80 : 70,
  }
}

const SHELL_EDITORS = /^(sed|perl|awk|set-content|add-content|out-file|clear-content|tee|truncate)$/i

/** A shell command that edits a lockfile in place or writes into one. */
export function lockfileShellEdit(segments: Segment[]): LockfileFinding | undefined {
  for (const s of segments) {
    const locks = s.args.filter((a) => isLockfile(a))
    if (!locks.length) continue
    const inPlace = (s.name === "sed" || s.name === "perl") ? s.args.some((a) => /^-[a-z]*i/.test(a) || a === "--in-place") : SHELL_EDITORS.test(s.name)
    if (inPlace || s.writes)
      return {
        ruleId: "lockfile-edited",
        reason: `It changes ${path.basename(locks[0]!)} from the shell, with no change to the manifest to explain it. A lockfile is normally written by the package manager.`,
        risk: 70,
      }
  }
  return undefined
}
