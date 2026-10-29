/**
 * Updates: looks for a new release every so often (30 minutes unless you change it), tells the desktop, and on your
 * word builds the new version beside this one and hands over to JCVC-Update.exe, which swaps the folders after JCVC
 * closes, starts the new version, and goes back to this one by itself if the new one does not start.
 *
 * Any version can follow any other: a release is complete, not a patch on the one before, so skipping versions is
 * safe. The previous version is kept next to the current one, so an update can be undone from Settings.
 */
import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { UPDATE_INTERVALS } from "@gatehouse/shared/node"
import { RELEASE_KEYS, verifyRelease, type ReleaseManifest } from "./manifest.js"
import { UpdateError, type UpdateSource } from "./source.js"
import { readInstalled, stageRelease, type StageProgress } from "./stage.js"
import { MANIFEST_FILE, STAGED_MARKER } from "./tree.js"
import { compareVersions, isNewer, parseVersion } from "./version.js"

export interface UpdateSettings {
  checkEveryMinutes: number
  downloadInBackground: boolean
  skipped: string[]
}

export interface UpdateResult {
  ok: boolean
  mode?: string
  from?: string
  to?: string
  reason?: string
  at?: string
}

export interface UpdateStatus {
  current: string
  /** "release": installed from a release or the installer. "source": run from the source folder. */
  kind: "release" | "source"
  canInstall: boolean
  why?: string
  previous?: string
  settings: UpdateSettings
  where: string
  tokenSet: boolean
  checking: boolean
  lastCheck?: string
  nextCheck?: string
  checkError?: string
  latest?: { version: string; notes: string; publishedAt?: string }
  /** A newer version you have not skipped. */
  available: boolean
  phase: "idle" | "preparing" | "ready" | "applying" | "failed"
  progress?: StageProgress
  error?: string
  /** The version built and checked beside this one, ready to switch to. */
  ready?: string
  lastResult?: UpdateResult
}

export interface UpdateServiceOptions {
  /** The folder JCVC.exe is in. Undefined when JCVC runs from its source folder. */
  installDir: string | undefined
  /** Version shown when there is no installed release.json (source folder). */
  sourceVersion: string
  /** %LOCALAPPDATA%\Gatehouse\updates */
  dir: string
  source: UpdateSource
  keys?: readonly string[]
  settings: () => UpdateSettings
  saveSettings: (s: UpdateSettings) => Promise<void>
  audit: (event: string, input: Record<string, unknown>) => Promise<void>
  log: (line: string) => void
  tokenSet?: () => boolean
  firstCheckDelayMs?: number
  stage?: typeof stageRelease
  now?: () => Date
}

export class UpdateService extends EventEmitter<{
  status: [UpdateStatus]
  apply: [{ updater: string; plan: string }]
}> {
  readonly #o: UpdateServiceOptions
  readonly #installed: ReturnType<typeof readInstalled>
  #timer: NodeJS.Timeout | undefined
  #checking = false
  #lastCheck: string | undefined
  #nextCheck: string | undefined
  #checkError: string | undefined
  #latest: { manifest: ReleaseManifest; bytes: Buffer; signature: string } | undefined
  #phase: UpdateStatus["phase"] = "idle"
  #progress: StageProgress | undefined
  #error: string | undefined
  #ready: string | undefined
  #lastResult: UpdateResult | undefined
  #why: string | undefined
  #busy: Promise<unknown> = Promise.resolve()

  constructor(o: UpdateServiceOptions) {
    super()
    this.#o = o
    this.#installed = o.installDir ? readInstalled(o.installDir) : undefined
    fs.mkdirSync(o.dir, { recursive: true })
    this.#why = this.#whyNot()
    this.#readResult()
    // A version built before a restart is still ready if it is complete and newer.
    const marker = this.#staged && path.join(this.#staged, STAGED_MARKER)
    if (marker && fs.existsSync(marker)) {
      const v = fs.readFileSync(marker, "utf8").trim()
      if (parseVersion(v) && isNewer(v, this.current)) {
        this.#ready = v
        this.#phase = "ready"
      }
    }
  }

  get current(): string {
    return this.#installed?.version ?? this.#o.sourceVersion
  }

  get #staged(): string | undefined {
    return this.#o.installDir ? `${this.#o.installDir}.next` : undefined
  }

  get #previousDir(): string | undefined {
    return this.#o.installDir ? `${this.#o.installDir}.previous` : undefined
  }

  #whyNot(): string | undefined {
    if (!this.#o.installDir || !this.#installed)
      return "JCVC is running from its source folder. Update it with git pull, or install it with JCVC-Setup.exe."
    try {
      const probe = `${this.#o.installDir}.write-check`
      fs.mkdirSync(probe, { recursive: true })
      fs.rmSync(probe, { recursive: true, force: true })
    } catch {
      // Usually a copy an IT team installed for everyone (JCVC-Setup.msi with ALLUSERS=1, in Program Files).
      return `This copy of JCVC was installed where it cannot write (${this.#o.installDir}), usually for everyone on this computer, so it cannot update itself. New versions come as a newer JCVC-Setup.msi, which your IT team may install for you.`
    }
    return undefined
  }

  #readResult(): void {
    const file = path.join(this.#o.dir, "result.txt")
    if (!fs.existsSync(file)) {
      const seen = path.join(this.#o.dir, "result.seen.txt")
      if (fs.existsSync(seen)) this.#lastResult = parseResult(fs.readFileSync(seen, "utf8"))
      return
    }
    const r = parseResult(fs.readFileSync(file, "utf8"))
    fs.renameSync(file, path.join(this.#o.dir, "result.seen.txt"))
    this.#lastResult = r
    const event = r.ok
      ? r.mode === "rollback"
        ? "update_rolled_back"
        : "update_installed"
      : "update_failed"
    void this.#o.audit(event, { from: r.from, to: r.to, reason: r.reason }).catch(() => undefined)
    // A version that would not start here is not offered again until a newer one comes out.
    if (!r.ok && r.to && r.mode === "apply") void this.skip(r.to).catch(() => undefined)
  }

  status(): UpdateStatus {
    const s = this.#o.settings()
    const latest = this.#latest?.manifest
    const prev = this.#previousDir && readInstalled(this.#previousDir)
    return {
      current: this.current,
      kind: this.#installed ? "release" : "source",
      canInstall: this.#why === undefined,
      ...(this.#why ? { why: this.#why } : {}),
      ...(prev ? { previous: prev.version } : {}),
      settings: s,
      where: this.#o.source.describe(),
      tokenSet: this.#o.tokenSet?.() ?? false,
      checking: this.#checking,
      ...(this.#lastCheck ? { lastCheck: this.#lastCheck } : {}),
      ...(this.#nextCheck ? { nextCheck: this.#nextCheck } : {}),
      ...(this.#checkError ? { checkError: this.#checkError } : {}),
      ...(latest
        ? {
            latest: {
              version: latest.version,
              notes: latest.notes,
              ...(latest.publishedAt ? { publishedAt: latest.publishedAt } : {}),
            },
          }
        : {}),
      available:
        !!latest && isNewer(latest.version, this.current) && !s.skipped.includes(latest.version),
      phase: this.#phase,
      ...(this.#progress ? { progress: this.#progress } : {}),
      ...(this.#error ? { error: this.#error } : {}),
      ...(this.#ready ? { ready: this.#ready } : {}),
      ...(this.#lastResult ? { lastResult: this.#lastResult } : {}),
    }
  }

  #changed(): void {
    this.emit("status", this.status())
  }

  start(): void {
    this.#schedule(this.#o.firstCheckDelayMs ?? 60_000)
    void this.#cleanUp()
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
  }

  #schedule(delayMs?: number): void {
    this.stop()
    const every = this.#o.settings().checkEveryMinutes
    if (every === 0) {
      this.#nextCheck = undefined
      return
    }
    const ms = delayMs ?? every * 60_000
    const now = this.#o.now?.() ?? new Date()
    this.#nextCheck = new Date(now.getTime() + ms).toISOString()
    this.#timer = setTimeout(() => {
      void this.check().finally(() => this.#schedule())
    }, ms)
    this.#timer.unref?.()
  }

  /** Looks for a new release now. Never throws: a failure is shown, and the next check tries again. */
  async check(): Promise<UpdateStatus> {
    if (this.#checking) return this.status()
    this.#checking = true
    this.#changed()
    try {
      const got = await this.#o.source.latest()
      this.#lastCheck = (this.#o.now?.() ?? new Date()).toISOString()
      if (!got) {
        this.#checkError = undefined
        this.#latest = undefined
        return this.status()
      }
      const v = verifyRelease(got.bytes, got.signature, this.#o.keys ?? RELEASE_KEYS)
      if (!v.ok) throw new UpdateError(v.error)
      this.#latest = { manifest: v.manifest, bytes: got.bytes, signature: got.signature }
      this.#checkError = undefined
      const st = this.status()
      if (
        st.available &&
        st.canInstall &&
        this.#o.settings().downloadInBackground &&
        this.#phase !== "preparing" &&
        this.#phase !== "applying" &&
        this.#ready !== v.manifest.version
      )
        void this.prepare(v.manifest.version).catch(() => undefined)
    } catch (e) {
      this.#lastCheck = (this.#o.now?.() ?? new Date()).toISOString()
      this.#checkError =
        e instanceof UpdateError ? e.message : `Could not reach GitHub: ${(e as Error).message}`
    } finally {
      this.#checking = false
      this.#changed()
    }
    return this.status()
  }

  /** Builds the given version beside this one. It must be the newest release found by the last check. */
  async prepare(version: string): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    const l = this.#latest
    if (!l || l.manifest.version !== version)
      throw new UpdateError(
        `Version ${version} is not the newest release. Check for updates again.`,
      )
    if (!isNewer(version, this.current))
      throw new UpdateError(`Version ${version} is not newer than ${this.current}.`)
    if (this.#phase === "preparing" || this.#phase === "applying") return this.status()
    if (this.#phase === "ready" && this.#ready === version) return this.status()
    this.#phase = "preparing"
    this.#error = undefined
    this.#ready = undefined
    this.#changed()
    const run = (this.#o.stage ?? stageRelease)({
      manifest: l.manifest,
      manifestBytes: l.bytes,
      signature: l.signature,
      installDir: this.#o.installDir as string,
      stagedDir: this.#staged as string,
      downloadsDir: path.join(this.#o.dir, "downloads"),
      installed: this.#installed,
      source: this.#o.source,
      onProgress: (p) => {
        this.#progress = p
        this.#changed()
      },
    })
    this.#busy = run.catch(() => undefined)
    try {
      await run
      this.#phase = "ready"
      this.#ready = version
      this.#progress = undefined
      void this.#o.audit("update_downloaded", { version }).catch(() => undefined)
    } catch (e) {
      this.#phase = "failed"
      this.#progress = undefined
      this.#error =
        e instanceof UpdateError
          ? e.message
          : `The update could not be prepared: ${(e as Error).message}`
      this.#o.log(`update ${version} not prepared: ${(e as Error).message}`)
      await fs.promises
        .rm(this.#staged as string, { recursive: true, force: true })
        .catch(() => undefined)
    } finally {
      this.#changed()
    }
    return this.status()
  }

  /** Switches to the version that is ready. JCVC closes and JCVC-Update.exe takes over. */
  async apply(version: string): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    if (this.#phase !== "ready" || this.#ready !== version)
      throw new UpdateError(`Version ${version} is not ready yet.`)
    const updater = path.join(this.#staged as string, "JCVC-Update.exe")
    if (!fs.existsSync(updater))
      throw new UpdateError("The new version has no JCVC-Update.exe, so it cannot be switched to.")
    await this.#handOver(updater, "apply", this.#staged as string, version)
    return this.status()
  }

  /** Goes back to the version kept beside this one. The version you leave is skipped. */
  async rollback(): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    const prev = this.#previousDir && readInstalled(this.#previousDir)
    if (!prev) throw new UpdateError("There is no earlier version kept to go back to.")
    const updater = path.join(this.#o.installDir as string, "JCVC-Update.exe")
    if (!fs.existsSync(updater))
      throw new UpdateError("JCVC-Update.exe is missing from this version.")
    await this.skip(this.current)
    await this.#handOver(updater, "rollback", this.#previousDir as string, prev.version)
    return this.status()
  }

  async #handOver(
    updaterSrc: string,
    mode: "apply" | "rollback",
    candidate: string,
    to: string,
  ): Promise<void> {
    await this.#busy
    const updater = path.join(this.#o.dir, "JCVC-Update.exe")
    fs.copyFileSync(updaterSrc, updater)
    const plan = path.join(this.#o.dir, "plan.txt")
    const health = path.join(this.#o.dir, "started.json")
    fs.writeFileSync(
      plan,
      [
        `mode=${mode}`,
        `install=${this.#o.installDir}`,
        `candidate=${candidate}`,
        `previous=${this.#previousDir}`,
        `from=${this.current}`,
        `to=${to}`,
        `health=${health}`,
        `result=${path.join(this.#o.dir, "result.txt")}`,
        "timeout=240",
        "",
      ].join("\r\n"),
    )
    this.#phase = "applying"
    this.#changed()
    await this.#o.audit(mode === "apply" ? "update_started" : "update_rollback_started", {
      from: this.current,
      to,
    })
    this.emit("apply", { updater, plan })
  }

  /** Called once the Host is ready, so JCVC-Update.exe knows the version it started really works. */
  markStarted(pid: number): void {
    if (!this.#installed) return
    const file = path.join(this.#o.dir, "started.json")
    fs.writeFileSync(
      file,
      JSON.stringify({ version: this.current, pid, at: new Date().toISOString() }) + "\n",
    )
  }

  async skip(version: string): Promise<UpdateStatus> {
    if (!parseVersion(version)) throw new UpdateError("That is not a version.")
    const s = this.#o.settings()
    if (!s.skipped.includes(version)) {
      await this.#o.saveSettings({ ...s, skipped: [...s.skipped, version].slice(-50) })
      void this.#o.audit("update_skipped", { version }).catch(() => undefined)
    }
    if (this.#ready === version && this.#phase === "ready") {
      this.#ready = undefined
      this.#phase = "idle"
      await fs.promises
        .rm(this.#staged as string, { recursive: true, force: true })
        .catch(() => undefined)
    }
    this.#changed()
    return this.status()
  }

  async unskip(version: string): Promise<UpdateStatus> {
    const s = this.#o.settings()
    await this.#o.saveSettings({ ...s, skipped: s.skipped.filter((v) => v !== version) })
    this.#changed()
    return this.status()
  }

  async setSettings(
    p: Partial<Pick<UpdateSettings, "checkEveryMinutes" | "downloadInBackground">>,
  ): Promise<UpdateStatus> {
    if (
      p.checkEveryMinutes !== undefined &&
      !(UPDATE_INTERVALS as readonly number[]).includes(p.checkEveryMinutes)
    )
      throw new UpdateError(`Check every must be one of ${UPDATE_INTERVALS.join(", ")} minutes.`)
    await this.#o.saveSettings({ ...this.#o.settings(), ...p })
    if (p.checkEveryMinutes !== undefined) this.#schedule()
    this.#changed()
    return this.status()
  }

  dismissResult(): UpdateStatus {
    this.#lastResult = undefined
    fs.rmSync(path.join(this.#o.dir, "result.seen.txt"), { force: true })
    this.#changed()
    return this.status()
  }

  /** Leftovers from earlier updates: half-built folders, swapped-out folders, old downloads. Best effort. */
  async #cleanUp(): Promise<void> {
    const install = this.#o.installDir
    if (!install) return
    const parent = path.dirname(install)
    const base = path.basename(install)
    try {
      for (const name of await fs.promises.readdir(parent)) {
        const full = path.join(parent, name)
        if (name.startsWith(`${base}.old-`) || name.startsWith(`${base}.failed-`))
          await fs.promises.rm(full, { recursive: true, force: true }).catch(() => undefined)
      }
      const staged = this.#staged as string
      if (fs.existsSync(staged) && !this.#ready && this.#phase === "idle")
        await fs.promises.rm(staged, { recursive: true, force: true }).catch(() => undefined)
      const dl = path.join(this.#o.dir, "downloads")
      if (fs.existsSync(dl))
        for (const v of await fs.promises.readdir(dl))
          if (v !== this.#ready && (!parseVersion(v) || compareVersions(v, this.current) <= 0))
            await fs.promises
              .rm(path.join(dl, v), { recursive: true, force: true })
              .catch(() => undefined)
    } catch {
      // Leftovers only cost disk space.
    }
  }

  /** The installed release.json, for the start-up line. */
  static installedVersion(installDir: string): string | undefined {
    try {
      return (
        JSON.parse(fs.readFileSync(path.join(installDir, MANIFEST_FILE), "utf8")) as {
          version?: string
        }
      ).version
    } catch {
      return undefined
    }
  }
}

/** result.txt, written by JCVC-Update.exe: key=value lines. */
export function parseResult(text: string): UpdateResult {
  const kv = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=")
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }
  const pick = (k: string) => (kv.get(k) ? { [k]: (kv.get(k) as string).slice(0, 500) } : {})
  return {
    ok: kv.get("ok") === "true",
    ...pick("mode"),
    ...pick("from"),
    ...pick("to"),
    ...pick("reason"),
    ...pick("at"),
  }
}
