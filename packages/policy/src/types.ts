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
  /**
   * Where an MCP server came from, as reported by the SDK (`sdk` is an in-process server this host
   * registered). Allow rules need the call's source to be in the list. Deny and escalate rules skip a
   * call only when its source is known and not in the list, so an unknown source is never favoured.
   */
  mcpSource?: string[]
  /**
   * The kinds of session it applies in (CH-03, ADR 0012). A call that does not say counts as a coding session, so a
   * rule for chats never loosens or tightens anything in a coding session.
   */
  sessionKinds?: SessionKind[]
  everySegmentMustMatch?: boolean
  risk?: number
  message?: string
  powershell?: PwshFlags
  bash?: BashFlags
  /** Internal, set only on remember rules: the command or path must match exactly. */
  remember?: boolean
  /** Internal, remember rules only (B31): sites a WebFetch may read, by host name, or *.example.com. https only. */
  urlHosts?: string[]
  /** Internal, remember rules only (B31): the projects it applies in, by folder name, lower case. Absent: every one. */
  projects?: string[]
  /** Internal, remember rules only (C-013): it no longer applies after this moment (ms since the epoch). */
  notAfter?: number
  /** Internal, remember rules only (C-013): it applies only to calls made in this folder or below (a real-path key). */
  withinKey?: string
  /** Internal, remember rules only (C-013): the most times it may allow before it asks again (the Host counts). */
  maxUses?: number
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
  /** D-055: the licences allowed without asking. Read from the managed policy only. */
  licences?: string[]
}

export interface RememberEntry {
  id: string
  tool: string
  command?: string
  path?: string
  /** B31: a site WebFetch may read without asking: a host name, or *.example.com for any part of it. */
  host?: string
  /** B31: the project it applies in, by its folder name. Absent: every project. */
  project?: string
  createdAt?: string
}

export interface RememberFile {
  version: 1
  remember: RememberEntry[]
}

/** One golden case shipped with a pack: what the engine must decide with the pack switched on. */
export interface PackCase {
  tool: string
  input: Record<string, unknown>
  expect: "allow" | "deny" | "escalate"
  rule?: string
  note?: string
}

/** A shipped pack of extra rules. It does nothing until it is switched on in your rules file. */
export interface RulePack {
  version: 1
  id: string
  title: string
  description: string
  allow?: Rule[]
  escalate?: Rule[]
  deny?: Rule[]
  /**
   * Allow or escalate rules this pack replaces, switched off while it is on: an ask beats an allow, so a pack that
   * allows what a built-in rule asks about must turn that rule off. A floor or deny rule here is a load error, and
   * an id that is not loaded (its pack is off) is ignored.
   */
  turnsOff?: string[]
  cases?: PackCase[]
}

/** Your own rules: packs switched on, built-in allow or escalate rules switched off, and rules you wrote. */
export interface UserRules {
  version: 1
  packs?: string[]
  disabled?: string[]
  allow?: Rule[]
  escalate?: Rule[]
  deny?: Rule[]
}

export interface Policy {
  /** B37: IT's signed policy was found, checked and applied. */
  managed?: boolean
  /** Base rules with workspaceRoots expanded, then switched-on packs and your rules merged in. */
  rules: RulesFile
  /** Where each rule came from: base, a pack, or yours. Not part of the hash. */
  sources?: Record<string, string>
  /** Overlays by project name (file name without extension). */
  overlays: Record<string, Overlay>
  remember: Rule[]
  /** D-053: dependencies the owner approved, "npm:name", "pypi:name"; beside rules.local.yaml. */
  approvedDependencies?: string[]
  /** D-055: the organisation's licence list, from the managed policy; when set, it is the list. */
  managedLicences?: string[]
  hash: string
  /** Real, lower-case, forward-slash keys of the workspace roots. */
  workspaceRootKeys: string[]
}

export interface ToolCall {
  toolName: string
  input: Record<string, unknown>
}

/** A chat, or a coding session (CH-03, ADR 0012). */
export type SessionKind = "code" | "chat"

export interface EvalContext {
  cwd: string
  /** For `mcp__*` tools: the SDK's report of where the server came from (`options.mcpServer.source`). */
  mcpSource?: string
  /** A chat or a coding session (CH-03). Absent: a coding session. */
  sessionKind?: SessionKind
  /** Defaults to the git root of cwd. */
  projectRoot?: string
  /** The moment the call is decided at, for grant expiry (C-013). Absent: now. */
  now?: number
}

/**
 * C-013: how long a remember rule lasts, where it applies and how often, kept beside rules.local.yaml in
 * rules.local.meta.json (by rule id), so an older version, which reads only rules.local.yaml, is not stopped by it.
 */
export interface GrantLimits {
  expiresAt?: string
  /** The folder it was made in; it applies there and below. */
  scope?: string
  maxUses?: number
}

export type RuleSection = "floor" | "deny" | "escalate" | "allow"

export type { Outcome }
