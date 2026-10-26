import type { Outcome } from "@gatehouse/shared"

export interface PwshFlags {
  encodedCommand?: boolean
  invokeExpression?: boolean
  dynamicInvocation?: boolean
}

export interface BashFlags {
  evalDynamic?: boolean
  pipeToShell?: boolean
}

export interface Rule {
  id: string
  /** Tool names. `*` is a wildcard. */
  tools?: string[]
  exceptTools?: string[]
  /** Shell command patterns, matched against each normalised segment. */
  commands?: string[]
  /** Globs. Floor, deny and escalate rules: any target matches. Allow rules: every target matches. */
  pathGlobs?: string[]
  pathInside?: "workspaceRoots"
  pathOutside?: "workspaceRoots"
  pathUnc?: boolean
  everySegmentMustMatch?: boolean
  risk?: number
  message?: string
  powershell?: PwshFlags
  bash?: BashFlags
  /** Internal, set only on remember rules: the command or path must match exactly. */
  remember?: boolean
  /** Internal, remember rules only: exact absolute path keys. */
  paths?: string[]
}

export interface RulesFile {
  version: 1
  workspaceRoots: string[]
  defaults?: {
    unknownTool?: "escalate"
    parseError?: "escalate"
    judge?: { enabled?: boolean; model?: string; maxInputChars?: number }
  }
  quietHours?: { start: string; end: string; tz: string; phone?: boolean }
  floor: Rule[]
  deny: Rule[]
  escalate: Rule[]
  allow: Rule[]
  judgeEligible?: string[]
}

export interface Overlay {
  version: 1
  project?: string
  deny?: Rule[]
  escalate?: Rule[]
  removeAllow?: string[]
}

export interface RememberEntry {
  id: string
  tool: string
  command?: string
  path?: string
  createdAt?: string
}

export interface RememberFile {
  version: 1
  remember: RememberEntry[]
}

export interface Policy {
  /** Base rules with workspaceRoots expanded. */
  rules: RulesFile
  /** Overlays by project name (file name without extension). */
  overlays: Record<string, Overlay>
  remember: Rule[]
  hash: string
  /** Real, lower-case, forward-slash keys of the workspace roots. */
  workspaceRootKeys: string[]
}

export interface ToolCall {
  toolName: string
  input: Record<string, unknown>
}

export interface EvalContext {
  cwd: string
  /** Defaults to the git root of cwd. */
  projectRoot?: string
}

export type RuleSection = "floor" | "deny" | "escalate" | "allow"

export type { Outcome }
