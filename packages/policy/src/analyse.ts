import fs from "node:fs"
import path from "node:path"
import picomatch from "picomatch"
import { analyseBash } from "./bash.js"
import { DYNAMIC_PLACEHOLDER, resolvePath, type ResolvedPath } from "./paths.js"
import { analysePwsh, PwshWorker } from "./pwsh.js"
import {
  baseCommandName,
  emptyAnalysis,
  mergeAnalysis,
  type Segment,
  type ShellAnalysis,
  type ShellFlags,
  type Token,
} from "./segments.js"
import type { EvalContext, ToolCall } from "./types.js"
import { shellCommand, wslCommand } from "./wsl.js"

export const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Grep", "Glob"])
export const SHELL_TOOLS = new Set(["Bash", "PowerShell"])
export const BUILTIN_KNOWN_TOOLS = new Set([
  ...FILE_TOOLS,
  ...SHELL_TOOLS,
  "WebFetch",
  "WebSearch",
])

export interface Features {
  tool: string
  isShell: boolean
  segments: Segment[]
  /** Resolved paths the call acts on: file arguments, or path-like words in a shell command. */
  targets: ResolvedPath[]
  /** Every word of the call, checked by the floor for secrets and critical paths. */
  scanTokens: Token[]
  flags: ShellFlags
  parseError: boolean
  /** The input did not have the shape the tool needs. */
  malformed: boolean
  /** A PowerShell parse was needed and the worker could not provide it. */
  unavailable: boolean
}

export interface AnalyseDeps {
  pwsh?: PwshWorker
}

const GLOB_CHARS = /[*?[]/
/**
 * 18 Nov: picomatch 4.0.7, the newest, takes exponential time on repeated extglobs (GHSA-fc5q-39xc-vjpf): 12 `+(a)`
 * against a 36 letter name took 4 s, 16 against 40 letters over three minutes, and the floor runs in the Host. A word
 * with more than this many is taken to match every file in its folder, which is quick and never less strict.
 */
const MAX_EXTGLOBS = 3

function looksLikePath(value: string): boolean {
  return (
    /[\\/]/.test(value) ||
    value.startsWith(".") ||
    value.startsWith("~") ||
    /^[a-zA-Z]:/.test(value) ||
    GLOB_CHARS.test(value) ||
    /~\d/.test(value) ||
    value.includes(DYNAMIC_PLACEHOLDER)
  )
}

/** Splits `--opt=value` and `-Param:value` so the value part can be treated as a path. */
function pathCandidates(value: string): string[] {
  const out = [value]
  const eq = /^-{1,2}[A-Za-z][\w-]*[=:](.+)$/s.exec(value)
  if (eq?.[1]) out.push(eq[1])
  return out
}

/**
 * Lists the files a glob word would expand to, so the floor can see through `cat .en?`.
 * Bash `*` does not match dot files, PowerShell wildcards do, hence `dotMatch`.
 */
function expandGlobToken(value: string, cwd: string, dotMatch: boolean): ResolvedPath[] {
  if (!GLOB_CHARS.test(value) || value.includes(DYNAMIC_PLACEHOLDER)) return []
  const norm = value.replace(/\\/g, "/")
  const slash = norm.lastIndexOf("/")
  const dirPart = slash >= 0 ? norm.slice(0, slash) : "."
  const filePart = slash >= 0 ? norm.slice(slash + 1) : norm
  if (GLOB_CHARS.test(dirPart) || filePart === "") return []
  const dir = resolvePath(dirPart === "" ? "/" : dirPart, cwd)
  const matcher =
    (filePart.match(/[@!?+*]\(/g)?.length ?? 0) > MAX_EXTGLOBS
      ? () => true
      : picomatch(filePart, { dot: dotMatch, nocase: true })
  let names: string[]
  try {
    names = fs.readdirSync(dir.abs)
  } catch {
    return []
  }
  return names.filter((n) => matcher(n)).slice(0, 200).map((n) => resolvePath(path.join(dir.abs, n), cwd))
}

function strField(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key]
  return typeof v === "string" && v !== "" ? v : undefined
}

const ENCODED = "-encodedcommand"
const COMMAND = "-command"

const LINUX_SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash"])

/**
 * Inspects a segment that starts another shell: encoded commands and nested -Command payloads, and (E-028) the Linux
 * command a wsl call runs, or a bash -c from PowerShell (the Bash parser unwraps its own bash -c).
 */
function inspectNativeShell(seg: Segment, out: ShellAnalysis, linux: string[]): void {
  const base = baseCommandName(seg.name)
  const inner = base === "wsl" ? wslCommand(seg.args) : seg.kind === "pwsh" && LINUX_SHELLS.has(base) ? shellCommand(seg.args) : undefined
  if (inner !== undefined) {
    if (seg.dynamic) {
      if (seg.kind === "pwsh") out.flags.dynamicInvocation = true
      else out.flags.evalDynamic = true
    } else linux.push(inner)
  }
  if (base === "reg" && /^(add|delete|import|copy|restore|load|unload)$/i.test(seg.args[0] ?? "")) {
    out.flags.registryWrite = true
  }
  if (base !== "pwsh" && base !== "powershell") return
  for (let i = 0; i < seg.args.length; i++) {
    const arg = (seg.args[i] ?? "").toLowerCase()
    if (arg.length >= 2 && ENCODED.startsWith(arg)) out.flags.encodedCommand = true
    if (arg === "-ec") out.flags.encodedCommand = true
    if (arg.length >= 2 && COMMAND.startsWith(arg)) {
      const rest = seg.args.slice(i + 1)
      const payload = rest.join(" ")
      if (rest.some((r) => r.includes(DYNAMIC_PLACEHOLDER)) || seg.dynamic) {
        out.flags.dynamicInvocation = true
      } else if (payload !== "") {
        out.pwshPayloads.push({ text: payload, dynamic: false })
      }
      break
    }
  }
}

const MAX_NESTING = 3

async function runPwsh(
  text: string,
  deps: AnalyseDeps,
  depth: number,
  state: { unavailable: boolean },
): Promise<ShellAnalysis> {
  if (!deps.pwsh || depth > MAX_NESTING) {
    state.unavailable ||= !deps.pwsh
    const empty = emptyAnalysis()
    if (depth > MAX_NESTING) empty.flags.dynamicInvocation = true
    return empty
  }
  try {
    return await analysePwsh(deps.pwsh, text)
  } catch {
    state.unavailable = true
    return emptyAnalysis()
  }
}

async function resolveNested(
  analysis: ShellAnalysis,
  deps: AnalyseDeps,
  depth: number,
  state: { unavailable: boolean },
): Promise<void> {
  const linux: string[] = []
  for (const seg of analysis.segments.slice()) inspectNativeShell(seg, analysis, linux)
  const payloads = analysis.pwshPayloads.splice(0)
  for (const p of payloads) {
    const inner = await runPwsh(p.text, deps, depth + 1, state)
    await resolveNested(inner, deps, depth + 1, state)
    mergeAnalysis(analysis, inner)
  }
  for (const text of linux) {
    if (depth >= MAX_NESTING) {
      analysis.flags.evalDynamic = true
      continue
    }
    // A Linux command that cannot be parsed sets parseError, which escalates.
    const inner = await analyseBash(text)
    await resolveNested(inner, deps, depth + 1, state)
    mergeAnalysis(analysis, inner)
  }
}

/** Fallback word list used when a parser could not run, so the floor can still look for secrets. */
function roughTokens(text: string): Token[] {
  return text
    .split(/[\s"'`;|&<>(){}]+/)
    .filter((t) => t !== "")
    .map((t) => ({ value: t, dynamic: /[$%]/.test(t) }))
}

export async function analyse(
  call: ToolCall,
  ctx: EvalContext,
  deps: AnalyseDeps = {},
): Promise<Features> {
  const { toolName: tool, input } = call
  const features: Features = {
    tool,
    isShell: SHELL_TOOLS.has(tool),
    segments: [],
    targets: [],
    scanTokens: [],
    flags: emptyAnalysis().flags,
    parseError: false,
    malformed: false,
    unavailable: false,
  }

  if (features.isShell) {
    const command = strField(input, "command")
    if (command === undefined) {
      features.malformed = true
      return features
    }
    const state = { unavailable: false }
    let analysis: ShellAnalysis
    try {
      analysis =
        tool === "Bash" ? await analyseBash(command) : await runPwsh(command, deps, 0, state)
      if (tool === "PowerShell" && state.unavailable) throw new Error("pwsh unavailable")
      await resolveNested(analysis, deps, 0, state)
    } catch {
      features.parseError = tool === "Bash"
      features.unavailable = tool === "PowerShell" || state.unavailable
      features.scanTokens = roughTokens(command)
      return features
    }
    features.segments = analysis.segments
    features.flags = analysis.flags
    features.parseError = analysis.parseError
    features.unavailable = state.unavailable
    features.scanTokens = analysis.tokens
    if (analysis.parseError) features.scanTokens.push(...roughTokens(command))
    for (const token of analysis.tokens) {
      for (const candidate of pathCandidates(token.value)) {
        if (!looksLikePath(candidate)) continue
        if (token.dynamic) continue
        features.targets.push(resolvePath(candidate, ctx.cwd, false, { missingTail: false }))
        features.targets.push(...expandGlobToken(candidate, ctx.cwd, tool === "PowerShell"))
      }
    }
    return features
  }

  switch (tool) {
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit": {
      const p = strField(input, "file_path")
      if (p === undefined) features.malformed = true
      else features.targets.push(resolvePath(p, ctx.cwd))
      break
    }
    case "NotebookEdit": {
      const p = strField(input, "notebook_path")
      if (p === undefined) features.malformed = true
      else features.targets.push(resolvePath(p, ctx.cwd))
      break
    }
    case "Grep":
    case "Glob": {
      const p = strField(input, "path")
      features.targets.push(resolvePath(p ?? ctx.cwd, ctx.cwd))
      const pattern = strField(input, tool === "Glob" ? "pattern" : "glob")
      if (pattern !== undefined) {
        features.scanTokens.push({ value: pattern, dynamic: false })
        const base = pattern.replace(/\\/g, "/")
        const staticPrefix = base.split("/").filter((s) => !GLOB_CHARS.test(s)).join("/")
        if (staticPrefix !== "" && staticPrefix !== base) {
          features.scanTokens.push({ value: staticPrefix, dynamic: false })
        }
      }
      break
    }
    case "WebFetch": {
      const url = strField(input, "url")
      if (url === undefined) features.malformed = true
      else if (/^file:/i.test(url)) {
        const p = decodeURIComponent(url.replace(/^file:\/*/i, ""))
        features.targets.push(resolvePath(p, ctx.cwd))
      }
      break
    }
    case "WebSearch": {
      if (strField(input, "query") === undefined) features.malformed = true
      break
    }
    default:
      break
  }
  for (const t of features.targets) features.scanTokens.push({ value: t.abs, dynamic: false })
  return features
}
