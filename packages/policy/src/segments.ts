/** A simple command found by a parser, normalised for rule matching. */
export interface Segment {
  kind: "bash" | "pwsh"
  /** Full normalised text: assignments, name and arguments, unquoted, single-spaced. */
  text: string
  /** Name and arguments only. */
  coreText: string
  /** Command name, canonical (PowerShell aliases resolved). Empty for assignment-only commands. */
  name: string
  args: string[]
  /** True when the name, an argument or an assignment value contains an expansion. */
  dynamic: boolean
  /** True when the segment redirects output to a file other than the null device. */
  writes: boolean
  /** True when the segment receives a pipe (it is not first in its pipeline). */
  piped?: boolean
}

/** A word that may name a path. `value` has expansions replaced by a placeholder. */
export interface Token {
  value: string
  dynamic: boolean
}

export interface ShellFlags {
  heredoc: boolean
  evalStatic: boolean
  evalDynamic: boolean
  pipeToShell: boolean
  encodedCommand: boolean
  invokeExpression: boolean
  dynamicInvocation: boolean
  startProcess: boolean
  scriptBlockCreate: boolean
  addType: boolean
  downloadString: boolean
  registryWrite: boolean
  executionPolicy: boolean
}

export function emptyFlags(): ShellFlags {
  return {
    heredoc: false,
    evalStatic: false,
    evalDynamic: false,
    pipeToShell: false,
    encodedCommand: false,
    invokeExpression: false,
    dynamicInvocation: false,
    startProcess: false,
    scriptBlockCreate: false,
    addType: false,
    downloadString: false,
    registryWrite: false,
    executionPolicy: false,
  }
}

export function mergeFlags(into: ShellFlags, from: ShellFlags): void {
  for (const key of Object.keys(into) as (keyof ShellFlags)[]) {
    if (from[key]) into[key] = true
  }
}

export interface ShellAnalysis {
  segments: Segment[]
  tokens: Token[]
  flags: ShellFlags
  parseError: boolean
  /** Payloads of nested `pwsh -Command` style invocations still to be analysed. */
  pwshPayloads: { text: string; dynamic: boolean }[]
}

export function emptyAnalysis(): ShellAnalysis {
  return { segments: [], tokens: [], flags: emptyFlags(), parseError: false, pwshPayloads: [] }
}

export function mergeAnalysis(into: ShellAnalysis, from: ShellAnalysis): void {
  into.segments.push(...from.segments)
  into.tokens.push(...from.tokens)
  mergeFlags(into.flags, from.flags)
  into.parseError ||= from.parseError
  into.pwshPayloads.push(...from.pwshPayloads)
}

export const SHELL_NAMES = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "ash",
  "csh",
  "tcsh",
  "fish",
  "pwsh",
  "powershell",
  "cmd",
])

export function baseCommandName(name: string): string {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"))
  const base = slash >= 0 ? name.slice(slash + 1) : name
  return base.replace(/\.(exe|cmd|bat|com|ps1)$/i, "").toLowerCase()
}

export const WRAPPER_NAMES = new Set([
  "env",
  "command",
  "builtin",
  "nohup",
  "time",
  "exec",
  "sudo",
  "doas",
  "nice",
  "stdbuf",
  "timeout",
])

/** Text variants of a segment with leading wrappers removed, for deny and floor matching. */
export function unwrapVariants(seg: Segment): string[] {
  const out: string[] = [seg.coreText]
  let name = seg.name
  let args = seg.args
  for (let hop = 0; hop < 4; hop++) {
    if (!WRAPPER_NAMES.has(baseCommandName(name))) break
    let i = 0
    while (i < args.length) {
      const a = args[i] ?? ""
      if (a.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) {
        i++
        continue
      }
      break
    }
    if (i >= args.length) break
    name = args[i] ?? ""
    args = args.slice(i + 1)
    out.push([name, ...args].join(" "))
  }
  return out
}
