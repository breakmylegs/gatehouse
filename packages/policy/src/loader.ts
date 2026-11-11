import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { canonicalize, sha256Hex } from "@gatehouse/shared"
import { FILE_TOOLS, SHELL_TOOLS } from "./analyse.js"
import { realKey, resolvePath, toKey } from "./paths.js"
import { isLocalAbsolute } from "./paths-mac.js" // Mac fork
import { checkOverlay, checkRememberFile, checkRulesFile } from "./schema.js"
import { loadLibrary, mergeRules, readUserRules } from "./library.js"
import type { GrantLimits, Overlay, Policy, RememberFile, Rule, RulesFile } from "./types.js"

export class PolicyLoadError extends Error {
  constructor(readonly errors: string[]) {
    super(`Policy failed to load: ${errors.join("; ")}`)
  }
}

export interface LoadOptions {
  rulesPath: string
  /** Directory of `<project>.yaml` overlays. Optional. */
  overlayDir?: string
  /** `rules.local.yaml`, written by the desktop UI. Optional. */
  localPath?: string
  /** Folder of shipped rule packs. Optional. */
  libraryDir?: string
  /** `rules.user.yaml`: packs switched on, rules switched off, your own rules. Optional. */
  userRulesPath?: string
  /** Replaces workspaceRoots (tests and settings). */
  workspaceRootsOverride?: string[]
  /** Added to the workspace roots: the projects folder from the settings. */
  extraWorkspaceRoots?: string[]
  /** Replaces `<you>` in workspace roots. Defaults to the current user name. */
  user?: string
  /**
   * B37: a folder IT keeps (such as %ProgramData%\\Codehouse\\managed, which you cannot change) holding policy.yaml,
   * policy.yaml.sig and key.pem. When policy.yaml is there, it must be signed with that key, and it applies to every
   * project as an overlay: it can add deny and escalate rules and remove allow rules, never allow anything.
   */
  managedDir?: string
}

/** The prefix of every error about IT's policy, so the Host can refuse to start sessions on one (B37). */
export const MANAGED_ERROR = "managed policy"

/** IT's signed policy, checked, or undefined when there is none. Problems go into errors. */
function readManaged(dir: string | undefined, errors: string[]): Overlay | undefined {
  if (!dir || !fs.existsSync(path.join(dir, "policy.yaml"))) return undefined
  const fail = (why: string) => {
    errors.push(`${MANAGED_ERROR}: ${why}`)
    return undefined
  }
  try {
    const data = fs.readFileSync(path.join(dir, "policy.yaml"))
    const sigFile = path.join(dir, "policy.yaml.sig")
    const keyFile = path.join(dir, "key.pem")
    if (!fs.existsSync(sigFile)) return fail("policy.yaml has no signature (policy.yaml.sig)")
    if (!fs.existsSync(keyFile)) return fail("there is no key to check it with (key.pem)")
    const key = crypto.createPublicKey(fs.readFileSync(keyFile, "utf8"))
    if (key.asymmetricKeyType !== "ed25519") return fail("key.pem is not an Ed25519 public key")
    const sig = Buffer.from(fs.readFileSync(sigFile, "utf8").trim(), "base64")
    if (!crypto.verify(null, data, key, sig)) return fail("the signature does not match policy.yaml, so it may have been changed")
    const checked = checkOverlay(parseYaml(data.toString("utf8")))
    if (!checked.ok) return fail(checked.errors.join("; "))
    return checked.value
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

function readYaml(file: string): unknown {
  return parseYaml(fs.readFileSync(file, "utf8"))
}

function hasSelector(rule: Rule): boolean {
  return Boolean(
    rule.tools ||
      rule.commands ||
      rule.pathGlobs ||
      rule.pathInside ||
      rule.pathOutside ||
      rule.pathUnc ||
      rule.powershell ||
      rule.bash,
  )
}

function checkRuleShapes(section: string, rules: Rule[], errors: string[]): void {
  for (const rule of rules) {
    if (!hasSelector(rule)) errors.push(`${section}/${rule.id}: rule has no selector and would match everything`)
    if (section === "allow") {
      if (rule.pathOutside || rule.pathUnc) {
        errors.push(`allow/${rule.id}: allow rules cannot use pathOutside or pathUnc`)
      }
      if (rule.powershell || rule.bash) {
        errors.push(`allow/${rule.id}: allow rules cannot use powershell or bash flags`)
      }
      if (!rule.tools && !rule.commands) {
        errors.push(`allow/${rule.id}: allow rules need tools or commands`)
      }
    }
  }
}

/** C-013: the file of grant limits beside rules.local.yaml. */
export const grantLimitsPath = (localPath: string) =>
  path.join(path.dirname(localPath), "rules.local.meta.json")

/** The grant limits by rule id, read tolerantly: no file, or one that cannot be read, gives none. */
export function readGrantLimits(localPath: string): Record<string, GrantLimits> {
  try {
    const raw = JSON.parse(fs.readFileSync(grantLimitsPath(localPath), "utf8")) as { grants?: unknown }
    return raw.grants && typeof raw.grants === "object" ? (raw.grants as Record<string, GrantLimits>) : {}
  } catch {
    return {}
  }
}

/**
 * The limits as the rule carries them. Fails closed: an expiry that cannot be read means expired, a scope that
 * cannot be resolved still restricts to the path as written, and a use limit that is not a whole number above zero
 * means none left.
 */
function limitsOf(g: GrantLimits | undefined): Pick<Rule, "notAfter" | "withinKey" | "maxUses"> {
  if (!g || typeof g !== "object") return {}
  const out: Pick<Rule, "notAfter" | "withinKey" | "maxUses"> = {}
  if (g.expiresAt !== undefined) {
    const t = typeof g.expiresAt === "string" ? Date.parse(g.expiresAt) : Number.NaN
    out.notAfter = Number.isNaN(t) ? 0 : t
  }
  if (g.scope !== undefined)
    out.withinKey = typeof g.scope === "string" && g.scope ? realKey(g.scope) : "\0"
  if (g.maxUses !== undefined)
    out.maxUses = Number.isInteger(g.maxUses) && (g.maxUses as number) > 0 ? (g.maxUses as number) : 0
  return out
}

function rememberToRules(
  file: RememberFile,
  errors: string[],
  limits: Record<string, GrantLimits> = {},
): Rule[] {
  const rules: Rule[] = []
  const seen = new Set<string>()
  for (const entry of file.remember) {
    const id = `remember-${entry.id}`
    if (seen.has(entry.id)) errors.push(`remember/${entry.id}: duplicate id`)
    seen.add(entry.id)
    if ([entry.command, entry.path, entry.host].filter(Boolean).length !== 1) {
      errors.push(`remember/${entry.id}: give exactly one of command, path or host`)
      continue
    }
    // B31: kept to one project when it names one. C-013: and to its time, folder and uses when they are set.
    const scope = {
      ...(entry.project ? { projects: [entry.project.toLowerCase()] } : {}),
      ...limitsOf(limits[entry.id]),
    }
    if (entry.host) {
      if (entry.tool !== "WebFetch") {
        errors.push(`remember/${entry.id}: a host rule needs tool WebFetch`)
        continue
      }
      rules.push({ id, tools: ["WebFetch"], urlHosts: [entry.host.toLowerCase()], ...scope, remember: true })
      continue
    }
    if (entry.command) {
      if (!SHELL_TOOLS.has(entry.tool)) {
        errors.push(`remember/${entry.id}: a command rule needs tool Bash or PowerShell`)
        continue
      }
      rules.push({ id, tools: [entry.tool], commands: [entry.command], ...scope, remember: true })
    } else if (entry.path) {
      if (!FILE_TOOLS.has(entry.tool) || entry.tool === "Grep" || entry.tool === "Glob") {
        errors.push(`remember/${entry.id}: a path rule needs a file tool (Read, Edit, Write, MultiEdit, NotebookEdit)`)
        continue
      }
      if (!isLocalAbsolute(entry.path)) { // Mac fork: a Mac's /Users/... too
        errors.push(`remember/${entry.id}: a path rule needs an absolute path`)
        continue
      }
      const resolved = resolvePath(entry.path, entry.path)
      rules.push({ id, tools: [entry.tool], paths: [resolved.key], ...scope, remember: true })
    }
  }
  return rules
}

/** Loads, validates and merges the rules, overlays and remember rules. Throws PolicyLoadError. */
export function loadPolicy(opts: LoadOptions): Policy {
  const errors: string[] = []
  let base: RulesFile | undefined
  try {
    const checked = checkRulesFile(readYaml(opts.rulesPath))
    if (checked.ok) base = checked.value
    else errors.push(...checked.errors.map((e) => `${path.basename(opts.rulesPath)}: ${e}`))
  } catch (e) {
    errors.push(`${path.basename(opts.rulesPath)}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!base) throw new PolicyLoadError(errors)

  const user = opts.user ?? os.userInfo().username
  const roots = [
    ...(opts.workspaceRootsOverride ?? base.workspaceRoots),
    ...(opts.extraWorkspaceRoots ?? []).map((r) => r.replace(/\\/g, "/")),
  ]
    .map((r) => r.replace(/<you>/g, user))
    .filter((r, i, all) => all.findIndex((x) => x.toLowerCase() === r.toLowerCase()) === i)
  const packs = loadLibrary(opts.libraryDir, errors)
  const userRules = readUserRules(opts.userRulesPath, errors)
  const merged = mergeRules({ ...base, workspaceRoots: roots }, packs, userRules, errors)
  const rules: RulesFile = merged.rules
  // B37: IT's rules last, over everything: tightening only.
  const managed = readManaged(opts.managedDir, errors)
  if (managed) {
    for (const id of managed.removeAllow ?? []) {
      if (!rules.allow.some((r) => r.id === id)) errors.push(`${MANAGED_ERROR}: removeAllow names unknown allow rule ${id}`)
    }
    const removed = new Set(managed.removeAllow ?? [])
    rules.allow = rules.allow.filter((r) => !removed.has(r.id))
    rules.deny = [...rules.deny, ...(managed.deny ?? [])]
    rules.escalate = [...rules.escalate, ...(managed.escalate ?? [])]
  }

  const ids = new Set<string>()
  for (const section of ["floor", "deny", "escalate", "allow"] as const) {
    checkRuleShapes(section, rules[section], errors)
    for (const rule of rules[section]) {
      if (ids.has(rule.id)) errors.push(`${section}/${rule.id}: duplicate rule id`)
      ids.add(rule.id)
    }
  }

  const overlays: Record<string, Overlay> = {}
  if (opts.overlayDir && fs.existsSync(opts.overlayDir)) {
    for (const file of fs.readdirSync(opts.overlayDir).sort()) {
      if (!/\.ya?ml$/i.test(file)) continue
      const name = file.replace(/\.ya?ml$/i, "").toLowerCase()
      try {
        const checked = checkOverlay(readYaml(path.join(opts.overlayDir, file)))
        if (!checked.ok) {
          errors.push(...checked.errors.map((e) => `overlay ${file}: ${e}`))
          continue
        }
        const overlay = checked.value
        if (overlay.project !== undefined && overlay.project.toLowerCase() !== name) {
          errors.push(`overlay ${file}: project "${overlay.project}" does not match the file name`)
        }
        checkRuleShapes("deny", overlay.deny ?? [], errors)
        checkRuleShapes("escalate", overlay.escalate ?? [], errors)
        for (const rule of [...(overlay.deny ?? []), ...(overlay.escalate ?? [])]) {
          if (ids.has(rule.id)) errors.push(`overlay ${file}: rule id ${rule.id} is already used`)
          ids.add(rule.id)
        }
        for (const id of overlay.removeAllow ?? []) {
          if (!rules.allow.some((r) => r.id === id)) {
            errors.push(`overlay ${file}: removeAllow names unknown allow rule ${id}`)
          }
        }
        overlays[name] = overlay
      } catch (e) {
        errors.push(`overlay ${file}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  let remember: Rule[] = []
  if (opts.localPath && fs.existsSync(opts.localPath)) {
    try {
      const checked = checkRememberFile(readYaml(opts.localPath))
      if (checked.ok) remember = rememberToRules(checked.value, errors, readGrantLimits(opts.localPath))
      else errors.push(...checked.errors.map((e) => `${path.basename(opts.localPath ?? "")}: ${e}`))
    } catch (e) {
      errors.push(`${path.basename(opts.localPath)}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (errors.length > 0) throw new PolicyLoadError(errors)

  const workspaceRootKeys = roots.map((r) => resolvePath(r, process.cwd()).key)
  const hash = sha256Hex(canonicalize({ rules, overlays, remember }))
  return {
    rules,
    sources: merged.sources,
    ...(managed ? { managed: true } : {}),
    overlays,
    remember,
    hash,
    workspaceRootKeys: workspaceRootKeys.map(toKey),
  }
}

export interface PolicyStatus {
  hash?: string
  errors: string[]
  overlays: string[]
  loadedAt?: string
}

/** Holds the live policy. A file that fails to load never replaces a good policy. */
export class PolicyStore {
  readonly #opts: LoadOptions
  #current: Policy | undefined
  #errors: string[] = []
  #loadedAt: string | undefined
  #watchers: fs.FSWatcher[] = []
  #timer: NodeJS.Timeout | undefined
  onChange: ((status: PolicyStatus) => void) | undefined

  constructor(opts: LoadOptions) {
    this.#opts = opts
  }

  get current(): Policy | undefined {
    return this.#current
  }

  status(): PolicyStatus {
    return {
      hash: this.#current?.hash,
      errors: [...this.#errors],
      overlays: Object.keys(this.#current?.overlays ?? {}),
      loadedAt: this.#loadedAt,
    }
  }

  /** Returns true when a new policy was installed. */
  load(): boolean {
    try {
      const next = loadPolicy(this.#opts)
      const changed = next.hash !== this.#current?.hash
      this.#current = next
      this.#errors = []
      this.#loadedAt = new Date().toISOString()
      return changed
    } catch (e) {
      this.#errors = e instanceof PolicyLoadError ? e.errors : [String(e)]
      return false
    }
  }

  watch(debounceMs = 150): void {
    const dirs = new Set<string>([path.dirname(this.#opts.rulesPath)])
    if (this.#opts.overlayDir) dirs.add(this.#opts.overlayDir)
    if (this.#opts.libraryDir) dirs.add(this.#opts.libraryDir)
    if (this.#opts.userRulesPath) dirs.add(path.dirname(this.#opts.userRulesPath))
    if (this.#opts.localPath) dirs.add(path.dirname(this.#opts.localPath))
    if (this.#opts.managedDir) dirs.add(this.#opts.managedDir)
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      const watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
        // Only rules files matter (and IT's signature and key, B37). Unrelated activity in the folder (audit files,
        // temp files) must not keep pushing the reload back.
        if (filename && !/\.(ya?ml|sig|pem)$/i.test(String(filename))) return
        clearTimeout(this.#timer)
        this.#timer = setTimeout(() => {
          this.load()
          this.onChange?.(this.status())
        }, debounceMs)
      })
      this.#watchers.push(watcher)
    }
  }

  close(): void {
    clearTimeout(this.#timer)
    for (const w of this.#watchers) w.close()
    this.#watchers = []
  }
}
