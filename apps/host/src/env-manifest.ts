/**
 * E-025, an environment manifest and drift (Expansion E3). The tools a project is built with, as this computer has
 * them (node, npm, pnpm, the .NET SDKs, python, pwsh, git, java, each asked for its version with a fixed command), the
 * versions the project asks for (.nvmrc, .node-version, global.json, rust-toolchain, package.json engines), and the
 * names of the environment variables, never their values. Kept in the project's .codehouse/environment.json; where
 * what is installed does not meet what is asked for, that is drift, and it is said plainly.
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

export interface EnvManifest {
  v: 1
  at: string
  tools: Record<string, string>
  dotnetSdks: string[]
  pins: Record<string, string>
  /** Environment variable names only; never a value. */
  variables: string[]
}

export interface Drift {
  tool: string
  wanted: string
  from: string
  have: string
}

export type Run = (file: string, args: string[]) => Promise<string>

const run: Run = (file, args) =>
  new Promise((resolve) => {
    // npm, pnpm and the like are .cmd files on Windows, which only a shell starts; the command is fixed text.
    const win = process.platform === "win32"
    const [f, a] = win && !/\.exe$/i.test(file) && file !== process.execPath ? ["cmd.exe", ["/d", "/c", [file, ...args].join(" ")]] : [file, args]
    execFile(f, a as string[], { windowsHide: true, timeout: 15_000 }, (e, out, err) => resolve(e ? "" : `${out}\n${err}`.trim()))
  })

const firstVersion = (s: string) => /(\d+\.\d+(?:\.\d+)?)/.exec(s)?.[1]

/** The versions of the tools that are on this computer; a tool that is not there is left out. */
export async function toolVersions(r: Run = run): Promise<{ tools: Record<string, string>; dotnetSdks: string[] }> {
  const tools: Record<string, string> = {}
  const ask = async (name: string, file: string, args: string[]) => {
    const v = firstVersion(await r(file, args))
    if (v) tools[name] = v
  }
  await Promise.all([
    ask("node", process.execPath, ["--version"]),
    ask("npm", "npm", ["--version"]),
    ask("pnpm", "pnpm", ["--version"]),
    ask("python", "python", ["--version"]),
    ask("pwsh", "pwsh", ["--version"]),
    ask("git", "git", ["--version"]),
    ask("java", "java", ["-version"]),
  ])
  const sdks = (await r("dotnet", ["--list-sdks"]))
    .split(/\r?\n/)
    .map((l) => /^(\d+\.\d+\.\d+\S*)/.exec(l.trim())?.[1])
    .filter((x): x is string => Boolean(x))
  if (sdks.length) tools.dotnet = sdks.at(-1)!
  return { tools, dotnetSdks: sdks }
}

const read = (f: string) => {
  try {
    return fs.readFileSync(f, "utf8")
  } catch {
    return undefined
  }
}

/** The versions the project asks for, by where it says so. */
export function projectPins(root: string): Record<string, string> {
  const pins: Record<string, string> = {}
  const nvm = read(path.join(root, ".nvmrc")) ?? read(path.join(root, ".node-version"))
  if (nvm?.trim()) pins["node (.nvmrc)"] = nvm.trim().replace(/^v/, "")
  try {
    const g = JSON.parse(read(path.join(root, "global.json")) ?? "") as { sdk?: { version?: unknown } }
    if (typeof g.sdk?.version === "string") pins["dotnet (global.json)"] = g.sdk.version
  } catch {
    // none
  }
  const rust = read(path.join(root, "rust-toolchain")) ?? read(path.join(root, "rust-toolchain.toml"))
  const channel = rust && (/channel\s*=\s*"([^"]+)"/.exec(rust)?.[1] ?? rust.trim().split(/\r?\n/)[0])
  if (channel) pins["rust (rust-toolchain)"] = channel
  try {
    const pkg = JSON.parse(read(path.join(root, "package.json")) ?? "") as { engines?: Record<string, unknown> }
    for (const [k, v] of Object.entries(pkg.engines ?? {})) if (typeof v === "string") pins[`${k} (engines)`] = v
  } catch {
    // none
  }
  return pins
}

const nums = (v: string) => v.replace(/^v/, "").split(".").map((x) => Number.parseInt(x, 10) || 0)
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  return 0
}

/** Whether a version meets a range in the common forms: 22, 22.x, ^22.1, ~22.1.0, >=18, >=18 <23, a || b. */
export function satisfies(version: string, range: string): boolean {
  const v = nums(version)
  return range.split("||").some((alt) =>
    alt
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((part) => {
        const m = /^(>=|<=|>|<|=|\^|~)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(part)
        if (!m) return true
        const [, op = "", maj, min, pat] = m
        const want = [Number(maj), min && /\d/.test(min) ? Number(min) : 0, pat && /\d/.test(pat) ? Number(pat) : 0]
        const c = cmp(v, want)
        if (op === ">=") return c >= 0
        if (op === ">") return c > 0
        if (op === "<=") return c <= 0
        if (op === "<") return c < 0
        if (op === "^") return v[0] === want[0] && c >= 0
        if (op === "~") return v[0] === want[0] && v[1] === want[1] && c >= 0
        // A bare version: as precise as it is written.
        if (min === undefined || min === "x" || min === "*") return v[0] === want[0]
        if (pat === undefined || pat === "x" || pat === "*") return v[0] === want[0] && v[1] === want[1]
        return c === 0
      }),
  )
}

/** Where what is installed does not meet what the project asks for. */
export function drift(m: Pick<EnvManifest, "tools" | "dotnetSdks" | "pins">): Drift[] {
  const out: Drift[] = []
  for (const [key, wanted] of Object.entries(m.pins)) {
    const tool = key.split(" ")[0]!
    const from = /\((.+)\)/.exec(key)?.[1] ?? ""
    if (tool === "dotnet") {
      if (!m.dotnetSdks.some((s) => s === wanted || s.startsWith(wanted)))
        out.push({ tool, wanted, from, have: m.dotnetSdks.length ? m.dotnetSdks.join(", ") : "none" })
      continue
    }
    const have = m.tools[tool]
    if (!have) {
      if (tool !== "rust" && tool !== "yarn") out.push({ tool, wanted, from, have: "not installed" })
      continue
    }
    if (!satisfies(have, wanted)) out.push({ tool, wanted, from, have })
  }
  return out
}

/** The manifest for a project now: what is installed, what it asks for, and the variables by name. */
export async function makeManifest(root: string, env: NodeJS.ProcessEnv = process.env, r?: Run, now = new Date()): Promise<EnvManifest> {
  const { tools, dotnetSdks } = await toolVersions(r)
  return { v: 1, at: now.toISOString(), tools, dotnetSdks, pins: projectPins(root), variables: Object.keys(env).sort((a, b) => a.localeCompare(b)) }
}

export async function saveManifest(root: string, m: EnvManifest): Promise<string> {
  const file = path.join(root, ".codehouse", "environment.json")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await writeFileAtomic(file, JSON.stringify(m, null, 2) + "\n")
  return file
}
