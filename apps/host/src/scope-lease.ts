/**
 * D-023, the scope lease (Frontier build, Wave 4). In Auto and Accept edits, where Claude Code approves much by itself,
 * the plan you approved (or you, on the desktop) sets a lease: the paths a session may write and the command families
 * it may run. Anything outside it is asked about, whatever the rules would allow: the floor hook answers ask and
 * canUseTool escalates it (rule scope-lease). In Manual and Plan every call is asked already, so the lease is not used.
 */
import path from "node:path"
import { compileGlobs } from "@gatehouse/policy"
import { commandsOf, touchesOf } from "./effects.js"

export const SCOPE_LEASE_RULE = "scope-lease"
/** The modes the lease is used in: those where Claude Code approves calls by itself. */
export const LEASE_MODES: ReadonlySet<string> = new Set(["acceptEdits", "auto"])

export interface ScopeLease {
  /** Globs from the project's folder, such as "apps/host/src/**". */
  paths: string[]
  /** First words of the commands it may run, such as "npm" or "git". */
  commands: string[]
  from: "plan" | "you"
  at: string
}

/** Commands that read and change nothing, always within a lease. */
const READ_ONLY = new Set([
  "cd", "pwd", "ls", "dir", "echo", "cat", "type", "head", "tail", "wc", "grep", "rg", "sort", "uniq", "which", "where",
  "get-childitem", "gci", "get-content", "gc", "select-string", "sls", "get-location", "set-location", "write-output",
  "test-path", "get-item", "measure-object", "select-object", "where-object", "format-table", "out-string",
])
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

/** The command families a plan's code spans start with, from those a session commonly runs. */
const FAMILIES = new Set([
  "npm", "npx", "pnpm", "yarn", "node", "tsx", "tsc", "vitest", "jest", "eslint", "prettier", "git", "gh", "python",
  "python3", "pip", "pytest", "uv", "poetry", "dotnet", "msbuild", "cargo", "go", "make", "cmake", "mvn", "gradle",
  "java", "ruby", "bundle", "rake", "php", "composer", "docker", "kubectl", "helm", "terraform", "pwsh", "deno", "bun",
])

const rel = (root: string, abs: string) => path.relative(root, abs).replace(/\\/g, "/")

/** Why a call is outside the lease, or undefined when it is within it (or is not a write or a command). */
export function outsideLease(lease: ScopeLease, root: string, cwd: string, toolName: string, input: Record<string, unknown>): string | undefined {
  const within = compileGlobs(lease.paths)
  const pathOk = (abs: string) => {
    const r = rel(root, abs)
    return r !== "" && !r.startsWith("..") && !path.isAbsolute(r) && within(r)
  }
  if (EDIT_TOOLS.has(toolName)) {
    const file = String(input.file_path ?? input.notebook_path ?? "")
    if (!file) return undefined
    const abs = path.resolve(cwd, file)
    return pathOk(abs) ? undefined : `It writes ${rel(root, abs) || abs}, outside the paths the scope lease allows (${lease.paths.join(", ") || "none"}).`
  }
  if (toolName !== "Bash" && toolName !== "PowerShell") return undefined
  const command = typeof input.command === "string" ? input.command : ""
  const allowed = new Set(lease.commands.map((c) => c.toLowerCase()))
  for (const words of commandsOf(command)) {
    let ws = words
    while (ws.length && /^\w+=/.test(ws[0]!)) ws = ws.slice(1)
    const name = path.basename(ws[0] ?? "").toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "")
    if (!name || READ_ONLY.has(name) || allowed.has(name)) continue
    return `It runs ${name}, which is not among the commands the scope lease allows (${lease.commands.join(", ") || "none"}).`
  }
  // A redirect or a move writes too: within the lease's paths only.
  for (const t of touchesOf(toolName, input, cwd))
    if (!/[*?$%]/.test(t.path) && !pathOk(path.resolve(cwd, t.path)))
      return `It ${t.effect === "move" ? "moves" : "overwrites"} ${t.path}, outside the paths the scope lease allows (${lease.paths.join(", ") || "none"}).`
  return undefined
}

/**
 * A lease from an approved plan's words: the folders of the files and folders it names (each with everything under
 * it), and the command families its code spans start with. Undefined when it names no path, so no lease is set.
 */
export function leaseFromPlan(plan: string, now = new Date()): ScopeLease | undefined {
  const paths = new Set<string>()
  const PATHLIKE = /(?:^|[\s`'"(*[])((?:[\w.@-]+\/)+[\w.*@-]*|[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|py|cs|go|rs|java|kt|rb|php|yaml|yml|toml|sql|sh|ps1))(?=$|[\s`'"),.:;*\]])/gm
  for (const m of plan.matchAll(PATHLIKE)) {
    let p = m[1]!.replace(/^\.\//, "").replace(/\\/g, "/")
    if (p.startsWith("../") || path.isAbsolute(p)) continue
    const isDir = p.endsWith("/")
    p = p.replace(/\/+$/, "")
    const dir = isDir || !/\.\w+$/.test(p) ? p : path.posix.dirname(p)
    paths.add(dir === "." ? path.posix.basename(p) : `${dir}/**`)
  }
  if (!paths.size) return undefined
  const commands = new Set<string>()
  for (const m of plan.matchAll(/`([^`\n]+)`/g)) {
    const first = m[1]!.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
    if (FAMILIES.has(first)) commands.add(first)
  }
  return { paths: [...paths].sort(), commands: [...commands].sort(), from: "plan", at: now.toISOString() }
}

/** A lease given from the desktop: trimmed, each path a glob inside the project, each command one word. */
export function cleanLease(paths: unknown, commands: unknown, now = new Date()): ScopeLease | string {
  if (!Array.isArray(paths) || !Array.isArray(commands)) return "Give paths and commands, each a list."
  const ps = paths.map((p) => String(p).trim().replace(/\\/g, "/")).filter(Boolean)
  const cs = commands.map((c) => String(c).trim().toLowerCase()).filter(Boolean)
  if (!ps.length) return "Give at least one path."
  if (ps.length > 50 || cs.length > 50) return "At most 50 paths and 50 commands."
  if (ps.some((p) => p.startsWith("..") || path.isAbsolute(p) || /^[a-z]:/i.test(p) || p.length > 200)) return "Each path is a glob inside the project, such as src/**."
  if (cs.some((c) => !/^[\w.-]{1,40}$/.test(c))) return "Each command is one word, such as npm or git."
  return { paths: [...new Set(ps)], commands: [...new Set(cs)], from: "you", at: now.toISOString() }
}
