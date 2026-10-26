import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { canonicalize, sha256Hex } from "@gatehouse/shared"
import { FILE_TOOLS, SHELL_TOOLS } from "./analyse.js"
import { resolvePath, toKey } from "./paths.js"
import { checkOverlay, checkRememberFile, checkRulesFile } from "./schema.js"
import type { Overlay, Policy, RememberFile, Rule, RulesFile } from "./types.js"

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
  /** Replaces workspaceRoots (tests and settings). */
  workspaceRootsOverride?: string[]
  /** Replaces `<you>` in workspace roots. Defaults to the current user name. */
  user?: string
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

function rememberToRules(file: RememberFile, errors: string[]): Rule[] {
  const rules: Rule[] = []
  const seen = new Set<string>()
  for (const entry of file.remember) {
    const id = `remember-${entry.id}`
    if (seen.has(entry.id)) errors.push(`remember/${entry.id}: duplicate id`)
    seen.add(entry.id)
    if (Boolean(entry.command) === Boolean(entry.path)) {
      errors.push(`remember/${entry.id}: give exactly one of command or path`)
      continue
    }
    if (entry.command) {
      if (!SHELL_TOOLS.has(entry.tool)) {
        errors.push(`remember/${entry.id}: a command rule needs tool Bash or PowerShell`)
        continue
      }
      rules.push({ id, tools: [entry.tool], commands: [entry.command], remember: true })
    } else if (entry.path) {
      if (!FILE_TOOLS.has(entry.tool) || entry.tool === "Grep" || entry.tool === "Glob") {
        errors.push(`remember/${entry.id}: a path rule needs a file tool (Read, Edit, Write, MultiEdit, NotebookEdit)`)
        continue
      }
      if (!/^[a-zA-Z]:[\\/]/.test(entry.path)) {
        errors.push(`remember/${entry.id}: a path rule needs an absolute path`)
        continue
      }
      const resolved = resolvePath(entry.path, entry.path)
      rules.push({ id, tools: [entry.tool], paths: [resolved.key], remember: true })
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
  const roots = (opts.workspaceRootsOverride ?? base.workspaceRoots).map((r) => r.replace(/<you>/g, user))
  const rules: RulesFile = { ...base, workspaceRoots: roots }

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
      if (checked.ok) remember = rememberToRules(checked.value, errors)
      else errors.push(...checked.errors.map((e) => `${path.basename(opts.localPath ?? "")}: ${e}`))
    } catch (e) {
      errors.push(`${path.basename(opts.localPath)}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (errors.length > 0) throw new PolicyLoadError(errors)

  const workspaceRootKeys = roots.map((r) => resolvePath(r, process.cwd()).key)
  const hash = sha256Hex(canonicalize({ rules, overlays, remember }))
  return { rules, overlays, remember, hash, workspaceRootKeys: workspaceRootKeys.map(toKey) }
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
    if (this.#opts.localPath) dirs.add(path.dirname(this.#opts.localPath))
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      const watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
        // Only rules files matter. Unrelated activity in the folder (audit files, temp files) must not
        // keep pushing the reload back.
        if (filename && !/\.ya?ml$/i.test(String(filename))) return
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
