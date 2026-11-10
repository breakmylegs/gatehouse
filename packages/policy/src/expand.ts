/**
 * D-013, effect-complete approval cards (Frontier build, Wave 1). A shell call can run far more than it says: npm test
 * runs the test script and its pre and post scripts, make runs a target's recipe, git commit runs the pre-commit hook,
 * a .cmd wrapper runs its lines, npx runs a local tool or fetches one, and PowerShell runs your profile first. Before a
 * shell call is decided, what it would run is expanded here, so each line is judged like the call itself and shown on
 * the card. What cannot be read is an unknown effect, which escalates.
 *
 * Approval laundering, where a harmless-looking call carries a harmful one, is what this stops.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Segment } from "./segments.js"

export interface Expanded {
  /** Where the line comes from: "npm script test", "git hook pre-commit", "Makefile target build". */
  from: string
  line: string
  /** How to judge it: as a Bash line or a PowerShell one. */
  shell: "bash" | "pwsh"
}

export interface Expansion {
  lines: Expanded[]
  /** What it would run that cannot be read: a tool npx would fetch, a hook that is a program. */
  unknown: string[]
}

const MAX_DEPTH = 5
const MAX_LINES = 200

function read(file: string): string | undefined {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > 1_000_000) return undefined
    return fs.readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

/** The lines of a script, comments and blank lines left out. */
const scriptLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !/^@?rem\b/i.test(l) && !/^::/.test(l) && !/^@?echo off$/i.test(l))

/** The nearest folder at or above `cwd` holding `name`. */
function upFind(cwd: string, name: string): string | undefined {
  let cur = path.resolve(cwd)
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(cur, name))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) return undefined
    cur = parent
  }
  return undefined
}

interface Ctx {
  cwd: string
  out: Expansion
  seen: Set<string>
  depth: number
}

function add(c: Ctx, e: Expanded): void {
  if (c.out.lines.length >= MAX_LINES) return
  c.out.lines.push(e)
  // What a line itself runs is expanded too, a few levels deep.
  if (c.depth < MAX_DEPTH) expandLine(e.line, { ...c, depth: c.depth + 1 })
}

/** npm, pnpm or yarn running a script: its pre and post scripts with it. Lifecycle scripts for install. */
function npmScripts(words: string[], c: Ctx): void {
  const tool = words[0]!.toLowerCase()
  const rest = words.slice(1)
  let script: string | undefined
  const sub = rest[0]?.toLowerCase()
  if (sub === "run" || sub === "run-script") script = rest[1]
  else if (sub === "test" || sub === "t" || sub === "start" || sub === "stop" || sub === "restart") script = sub === "t" ? "test" : sub
  else if (tool !== "npm" && sub && !sub.startsWith("-") && !["install", "add", "i", "exec", "dlx", "remove"].includes(sub)) script = sub
  const install = sub === "install" || sub === "i" || sub === "ci" || (tool !== "npm" && sub === undefined)
  const root = upFind(c.cwd, "package.json")
  if (!root) return
  let pkg: { scripts?: Record<string, string> }
  try {
    pkg = JSON.parse(read(path.join(root, "package.json")) ?? "{}")
  } catch {
    c.out.unknown.push("package.json could not be read")
    return
  }
  const scripts = pkg.scripts ?? {}
  const names = install
    ? ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare"]
    : script
      ? [`pre${script}`, script, `post${script}`]
      : []
  for (const n of names) {
    const body = scripts[n]
    const key = `npm:${root}:${n}`
    if (typeof body !== "string" || c.seen.has(key)) continue
    c.seen.add(key)
    add({ ...c, cwd: root }, { from: `npm script ${n}`, line: body, shell: "bash" })
  }
}

/** npx or npm exec: the local tool it resolves to, or a fetch from the registry, which cannot be read. */
function npxTool(words: string[], c: Ctx): void {
  const args = words.slice(words[0]!.toLowerCase() === "npm" ? 2 : 1).filter((w) => !w.startsWith("-"))
  const tool = args[0]
  if (!tool) return
  const root = upFind(c.cwd, "node_modules")
  const bin = root ? path.join(root, "node_modules", ".bin", tool.replace(/@[^/]*$/, "")) : undefined
  if (bin && (fs.existsSync(bin) || fs.existsSync(`${bin}.cmd`))) {
    c.out.lines.push({ from: `npx resolves ${tool}`, line: `node_modules/.bin/${tool} (a package installed in this project)`, shell: "bash" })
    return
  }
  c.out.unknown.push(`npx would fetch ${tool} from the package registry and run it`)
}

/** make: the recipe of the target asked for (or the first), and of the targets it needs. */
function makeTargets(words: string[], c: Ctx): void {
  const root = upFind(c.cwd, "Makefile") ?? upFind(c.cwd, "makefile")
  if (!root) return
  const text = read(path.join(root, "Makefile")) ?? read(path.join(root, "makefile")) ?? ""
  const rules = new Map<string, { deps: string[]; recipe: string[] }>()
  let current: string[] = []
  let first: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith("\t")) {
      for (const t of current) rules.get(t)?.recipe.push(raw.trim().replace(/^[@-]+/, ""))
      continue
    }
    const m = /^([A-Za-z0-9_.\-/ ]+?)\s*:(?!=)\s*(.*)$/.exec(raw)
    if (m) {
      current = m[1]!.split(/\s+/).filter(Boolean)
      for (const t of current) {
        if (!rules.has(t)) rules.set(t, { deps: m[2]!.split(/\s+/).filter(Boolean), recipe: [] })
        if (!first && !t.startsWith(".")) first = t
      }
    } else if (raw.trim()) current = []
  }
  const asked = words.slice(1).filter((w) => !w.startsWith("-") && !w.includes("="))
  const visit = (t: string) => {
    const key = `make:${root}:${t}`
    if (c.seen.has(key)) return
    c.seen.add(key)
    const r = rules.get(t)
    if (!r) return
    for (const d of r.deps) visit(d)
    for (const line of r.recipe) add({ ...c, cwd: root }, { from: `Makefile target ${t}`, line, shell: "bash" })
  }
  for (const t of asked.length ? asked : first ? [first] : []) visit(t)
}

const HOOKS: Record<string, string[]> = {
  commit: ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit"],
  push: ["pre-push"],
  merge: ["pre-merge-commit", "post-merge"],
  pull: ["post-merge"],
  checkout: ["post-checkout"],
  switch: ["post-checkout"],
  rebase: ["pre-rebase", "post-rewrite"],
  am: ["applypatch-msg", "pre-applypatch", "post-applypatch"],
}

/** git: the hooks the command would fire, from core.hooksPath or .git/hooks. */
function gitHooks(words: string[], c: Ctx): void {
  const sub = words.slice(1).find((w) => !w.startsWith("-"))?.toLowerCase()
  if (!sub || !HOOKS[sub] || words.includes("--no-verify") || words.includes("-n") && sub === "commit") return
  const root = upFind(c.cwd, ".git")
  if (!root) return
  const config = read(path.join(root, ".git", "config")) ?? ""
  const custom = /^\s*hooksPath\s*=\s*(.+)$/im.exec(config)?.[1]?.trim()
  const dir = custom ? path.resolve(root, custom) : path.join(root, ".git", "hooks")
  for (const hook of HOOKS[sub]!) {
    const file = [path.join(dir, hook), path.join(dir, `${hook}.cmd`), path.join(dir, `${hook}.ps1`)].find((f) =>
      fs.existsSync(f),
    )
    if (!file) continue
    const key = `hook:${file}`
    if (c.seen.has(key)) continue
    c.seen.add(key)
    const text = read(file)
    if (text === undefined || /[\u0000-\u0008]/.test(text.slice(0, 512))) {
      c.out.unknown.push(`the git hook ${hook} is a program Codehouse cannot read`)
      continue
    }
    const pwsh = file.endsWith(".ps1")
    for (const line of scriptLines(text).filter((l) => !l.startsWith("#!")))
      add({ ...c, cwd: root }, { from: `git hook ${hook}`, line, shell: pwsh ? "pwsh" : "bash" })
  }
}

/** A .cmd or .bat file run by name, in the folder or as a path. */
function wrapper(words: string[], c: Ctx): void {
  const name = words[0]!
  const candidates = /\.(cmd|bat)$/i.test(name)
    ? [path.resolve(c.cwd, name)]
    : [path.resolve(c.cwd, `${name}.cmd`), path.resolve(c.cwd, `${name}.bat`)]
  const file = candidates.find((f) => fs.existsSync(f))
  if (!file) return
  const key = `wrap:${file}`
  if (c.seen.has(key)) return
  c.seen.add(key)
  const text = read(file)
  if (text === undefined) {
    c.out.unknown.push(`${path.basename(file)} cannot be read`)
    return
  }
  for (const line of scriptLines(text)) add({ ...c, cwd: path.dirname(file) }, { from: path.basename(file), line, shell: "bash" })
}

/** dotnet running a local tool from the project's tool manifest: a program, so its effects are unknown. */
function dotnetTool(words: string[], c: Ctx): void {
  const sub = words[1]?.toLowerCase()
  if (!sub || sub.startsWith("-")) return
  const root = upFind(c.cwd, path.join(".config", "dotnet-tools.json"))
  if (!root) return
  try {
    const m = JSON.parse(read(path.join(root, ".config", "dotnet-tools.json")) ?? "{}") as {
      tools?: Record<string, { commands?: string[] }>
    }
    for (const [pkg, t] of Object.entries(m.tools ?? {}))
      if ((t.commands ?? []).some((x) => x.toLowerCase() === sub || x.toLowerCase() === `dotnet-${sub}`))
        c.out.unknown.push(`dotnet ${sub} runs the local tool ${pkg}, a program Codehouse cannot read`)
  } catch {
    c.out.unknown.push("the dotnet tool manifest could not be read")
  }
}

/** The words of each command of a shell line, quotes taken off. */
function commandsOf(line: string): string[][] {
  return line
    .split(/&&|\|\||[;|\n]/)
    .map((part) => [...part.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? ""))
    .map((w) => {
      // Assignments before the command name (A=1 npm test) are not the command.
      let i = 0
      while (i < w.length && /^[A-Za-z_]\w*=/.test(w[i]!)) i++
      return w.slice(i)
    })
    .filter((w) => w.length > 0)
}

function expandLine(line: string, c: Ctx): void {
  for (const words of commandsOf(line)) {
    const name = words[0]!.toLowerCase().replace(/\.exe$/, "")
    if (name === "npm" && /^(exec|x)$/i.test(words[1] ?? "")) npxTool(words, c)
    else if (name === "npm" || name === "pnpm" || name === "yarn") npmScripts(words, c)
    else if (name === "npx" || name === "pnpx") npxTool(words, c)
    else if (name === "make" || name === "mingw32-make" || name === "gmake") makeTargets(words, c)
    else if (name === "git") gitHooks(words, c)
    else if (name === "dotnet") dotnetTool(words, c)
    else if (/^[\w.\-\\/]+$/.test(words[0]!)) wrapper(words, c)
  }
}

/** The PowerShell profiles a pwsh call loads first, unless told not to. */
function profiles(c: Ctx, segments: Segment[]): void {
  if (segments.some((s) => /-noprofile|-nop\b/i.test(s.text))) return
  const docs = path.join(process.env.USERPROFILE ?? os.homedir(), "Documents")
  for (const p of [
    path.join(docs, "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(docs, "PowerShell", "profile.ps1"),
  ]) {
    const text = read(p)
    if (text === undefined) continue
    for (const line of scriptLines(text)) add(c, { from: `PowerShell profile ${path.basename(p)}`, line, shell: "pwsh" })
  }
}

/**
 * What a shell call would run besides what it says. `kind` is the call's shell; for PowerShell the profile comes
 * first. Nothing is run here: files are read, never executed.
 */
export function expandEffects(command: string, kind: "bash" | "pwsh", cwd: string, segments: Segment[] = []): Expansion {
  const c: Ctx = { cwd, out: { lines: [], unknown: [] }, seen: new Set(), depth: 0 }
  if (kind === "pwsh") profiles(c, segments)
  expandLine(command, c)
  return c.out
}
