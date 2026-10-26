import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DYNAMIC_PLACEHOLDER } from "./paths.js"
import { emptyAnalysis, type Segment, type ShellAnalysis } from "./segments.js"

interface RawElement {
  type: string
  value: string
  dynamic: boolean
}

interface RawCommand {
  name: string | null
  invocation: string
  elements: RawElement[]
}

export interface RawAnalysis {
  id?: number
  ok: boolean
  errors: string[]
  commands: RawCommand[]
  redirects: { target: string; dynamic: boolean; append: boolean }[]
  members: { member: string; target: string; static: boolean }[]
  strings: string[]
}

export class PwshUnavailableError extends Error {}

export interface PwshWorkerOptions {
  pwsh?: string
  script?: string
  timeoutMs?: number
}

const here = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SCRIPT = path.resolve(here, "../../../scripts/ps-ast.ps1")

/** A warm `pwsh` process that parses PowerShell text. Any failure rejects, never allows. */
export class PwshWorker {
  readonly #opts: Required<PwshWorkerOptions>
  #child: ChildProcessWithoutNullStreams | undefined
  #starting: Promise<void> | undefined
  #pending = new Map<number, { resolve: (r: RawAnalysis) => void; reject: (e: Error) => void }>()
  #nextId = 1
  #buffer = ""
  #lastFailure = 0
  #ready: ((mode: string) => void) | undefined
  languageMode: string | undefined

  constructor(opts: PwshWorkerOptions = {}) {
    this.#opts = {
      pwsh: opts.pwsh ?? "pwsh",
      script: opts.script ?? DEFAULT_SCRIPT,
      timeoutMs: opts.timeoutMs ?? 4000,
    }
  }

  get running(): boolean {
    return this.#child !== undefined
  }

  async start(): Promise<void> {
    if (this.#child) return
    this.#starting ??= this.#spawn().finally(() => {
      this.#starting = undefined
    })
    return this.#starting
  }

  #spawn(): Promise<void> {
    if (Date.now() - this.#lastFailure < 3000) {
      return Promise.reject(new PwshUnavailableError("pwsh worker failed recently"))
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        this.#lastFailure = Date.now()
        this.#teardown(err)
        reject(err)
      }
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(
          this.#opts.pwsh,
          ["-NoProfile", "-NonInteractive", "-File", this.#opts.script, "-Loop"],
          { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
        )
      } catch (e) {
        fail(new PwshUnavailableError(`cannot start pwsh: ${String(e)}`))
        return
      }
      this.#child = child
      this.#buffer = ""
      child.stdout.setEncoding("utf8")
      child.stderr.on("data", () => undefined)
      child.stdin.on("error", () => undefined)
      child.on("error", (e) => fail(new PwshUnavailableError(`pwsh error: ${e.message}`)))
      child.on("exit", () => {
        fail(new PwshUnavailableError("pwsh worker exited"))
        this.#teardown(new PwshUnavailableError("pwsh worker exited"))
      })
      const timer = setTimeout(
        () => fail(new PwshUnavailableError("pwsh worker did not become ready")),
        this.#opts.timeoutMs * 2,
      )
      this.#ready = (mode) => {
        clearTimeout(timer)
        settled = true
        this.languageMode = mode
        resolve()
      }
      child.stdout.on("data", (chunk: string) => this.#onData(chunk))
      child.unref()
    })
  }

  #onData(chunk: string): void {
    this.#buffer += chunk
    for (;;) {
      const nl = this.#buffer.indexOf("\n")
      if (nl < 0) break
      const line = this.#buffer.slice(0, nl).trim()
      this.#buffer = this.#buffer.slice(nl + 1)
      if (line === "") continue
      let msg: unknown
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      const obj = msg as Record<string, unknown>
      if (obj.ready === true && this.#ready) {
        const ready = this.#ready
        this.#ready = undefined
        ready(typeof obj.languageMode === "string" ? obj.languageMode : "Unknown")
        continue
      }
      const id = typeof obj.id === "number" ? obj.id : undefined
      if (id === undefined) continue
      const waiter = this.#pending.get(id)
      if (!waiter) continue
      this.#pending.delete(id)
      waiter.resolve(obj as unknown as RawAnalysis)
    }
  }

  #teardown(err: Error): void {
    const child = this.#child
    this.#child = undefined
    this.#ready = undefined
    if (child) {
      try {
        child.stdin.end()
        child.kill()
      } catch {
        // already gone
      }
    }
    for (const waiter of this.#pending.values()) waiter.reject(err)
    this.#pending.clear()
  }

  async parse(text: string): Promise<RawAnalysis> {
    await this.start()
    const child = this.#child
    if (!child) throw new PwshUnavailableError("pwsh worker is not running")
    const id = this.#nextId++
    const b64 = Buffer.from(text, "utf8").toString("base64")
    return new Promise<RawAnalysis>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        this.#lastFailure = Date.now()
        this.#teardown(new PwshUnavailableError("pwsh parse timed out"))
        reject(new PwshUnavailableError("pwsh parse timed out"))
      }, this.#opts.timeoutMs)
      this.#pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer)
          resolve(r)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      child.stdin.write(JSON.stringify({ id, b64 }) + "\n", (err) => {
        if (err) {
          clearTimeout(timer)
          this.#pending.delete(id)
          reject(new PwshUnavailableError(`pwsh write failed: ${err.message}`))
        }
      })
    })
  }

  close(): void {
    this.#teardown(new PwshUnavailableError("pwsh worker closed"))
  }
}

const ALIASES: Record<string, string> = {
  gci: "Get-ChildItem",
  ls: "Get-ChildItem",
  dir: "Get-ChildItem",
  gc: "Get-Content",
  cat: "Get-Content",
  type: "Get-Content",
  sc: "Set-Content",
  ac: "Add-Content",
  rm: "Remove-Item",
  ri: "Remove-Item",
  del: "Remove-Item",
  erase: "Remove-Item",
  rd: "Remove-Item",
  rmdir: "Remove-Item",
  cp: "Copy-Item",
  copy: "Copy-Item",
  cpi: "Copy-Item",
  mv: "Move-Item",
  move: "Move-Item",
  mi: "Move-Item",
  ni: "New-Item",
  ren: "Rename-Item",
  rni: "Rename-Item",
  cd: "Set-Location",
  sl: "Set-Location",
  chdir: "Set-Location",
  pwd: "Get-Location",
  gl: "Get-Location",
  echo: "Write-Output",
  write: "Write-Output",
  iex: "Invoke-Expression",
  iwr: "Invoke-WebRequest",
  irm: "Invoke-RestMethod",
  saps: "Start-Process",
  start: "Start-Process",
  select: "Select-Object",
  where: "Where-Object",
  "?": "Where-Object",
  foreach: "ForEach-Object",
  "%": "ForEach-Object",
  sls: "Select-String",
  gm: "Get-Member",
  gi: "Get-Item",
  si: "Set-Item",
  gp: "Get-ItemProperty",
  sp: "Set-ItemProperty",
  rp: "Remove-ItemProperty",
  kill: "Stop-Process",
  spps: "Stop-Process",
  ps: "Get-Process",
  gps: "Get-Process",
  icm: "Invoke-Command",
  ii: "Invoke-Item",
  measure: "Measure-Object",
  sort: "Sort-Object",
  tee: "Tee-Object",
  ft: "Format-Table",
  fl: "Format-List",
  gcm: "Get-Command",
  man: "Get-Help",
  help: "Get-Help",
  sv: "Set-Variable",
  set: "Set-Variable",
  gv: "Get-Variable",
  clc: "Clear-Content",
  cls: "Clear-Host",
  clear: "Clear-Host",
  h: "Get-History",
  history: "Get-History",
  sleep: "Start-Sleep",
  gwmi: "Get-WmiObject",
  rvpa: "Resolve-Path",
  rvpa2: "Resolve-Path",
  gu: "Get-Unique",
  diff: "Compare-Object",
}

/** Lower-case alias map lookup and module-qualified name stripping. */
export function canonicalCommandName(name: string): string {
  const qualified = /^[A-Za-z][\w.]*\\([A-Za-z][\w-]*)$/.exec(name)
  const bare = qualified?.[1] ?? name
  return ALIASES[bare.toLowerCase()] ?? bare
}

const REGISTRY_CMDLETS = new Set([
  "set-itemproperty",
  "new-itemproperty",
  "remove-itemproperty",
  "rename-itemproperty",
  "copy-itemproperty",
  "move-itemproperty",
  "clear-itemproperty",
  "new-item",
  "set-item",
  "remove-item",
  "copy-item",
  "move-item",
  "rename-item",
  "clear-item",
])

const REGISTRY_PATH = /^(hk(lm|cu|cr|u|cc)|hkey_[a-z_]+)(:|\\|\/)|^registry::/i

const DOWNLOAD_MEMBERS = /^(DownloadString|DownloadFile|DownloadData|UploadString|UploadFile|UploadData)$/i
const SCRIPT_MEMBERS = /^(InvokeScript|NewScriptBlock|ExpandString)$/i

/** Replaces variables and sub-expressions in a dynamic word with a placeholder, keeping the static parts. */
function placeholders(text: string): string {
  return text
    .replace(/\$\{[^}]*\}|\$\([^)]*\)|\$[\w:?]+|%[^%\s]+%/g, DYNAMIC_PLACEHOLDER)
    .replace(/^["']|["']$/g, "")
}

function isNullTarget(target: string): boolean {
  const t = target.toLowerCase()
  return t === "$null" || t === "nul" || t === "/dev/null"
}

/** Turns the parser output into segments, tokens and flags. */
export function toAnalysis(raw: RawAnalysis): ShellAnalysis {
  const out = emptyAnalysis()
  if (!raw.ok) {
    out.parseError = true
  }
  const writes = raw.redirects.some((r) => r.dynamic || !isNullTarget(r.target))
  for (const r of raw.redirects) out.tokens.push({ value: r.dynamic ? placeholders(r.target) : r.target, dynamic: r.dynamic })

  for (const cmd of raw.commands) {
    const elements = cmd.elements
    const dynamic = elements.some((e) => e.dynamic)
    const nameKnown = cmd.name !== null && cmd.name !== undefined && cmd.name !== ""
    const name = nameKnown ? canonicalCommandName(cmd.name as string) : ""
    if (!nameKnown) out.flags.dynamicInvocation = true
    const args = elements.slice(1).map((e) => e.value)
    const first = elements[0]
    const coreText = nameKnown
      ? [name, ...args].join(" ")
      : [first?.value ?? "", ...args].join(" ")
    const segment: Segment = {
      kind: "pwsh",
      text: coreText,
      coreText,
      name,
      args,
      dynamic: dynamic || !nameKnown,
      writes,
    }
    out.segments.push(segment)
    for (const el of elements) {
      out.tokens.push({ value: el.dynamic ? placeholders(el.value) : el.value, dynamic: el.dynamic })
    }

    const lower = name.toLowerCase()
    if (lower === "invoke-expression") out.flags.invokeExpression = true
    if (lower === "start-process") out.flags.startProcess = true
    if (lower === "add-type") out.flags.addType = true
    if (lower === "set-executionpolicy") out.flags.executionPolicy = true
    if (REGISTRY_CMDLETS.has(lower) && args.some((a) => REGISTRY_PATH.test(a.replace(/^-\w+:/, "")))) {
      out.flags.registryWrite = true
    }
  }
  for (const m of raw.members) {
    if (DOWNLOAD_MEMBERS.test(m.member)) out.flags.downloadString = true
    if (SCRIPT_MEMBERS.test(m.member)) out.flags.scriptBlockCreate = true
    if (/^create$/i.test(m.member) && /scriptblock\]?$/i.test(m.target.trim())) {
      out.flags.scriptBlockCreate = true
    }
  }
  for (const s of raw.strings) out.tokens.push({ value: s, dynamic: false })
  return out
}

export async function analysePwsh(worker: PwshWorker, text: string): Promise<ShellAnalysis> {
  const raw = await worker.parse(text)
  return toAnalysis(raw)
}
