/**
 * Updates: looks for a new release every so often (30 minutes unless you change it), tells the desktop, and on your
 * word builds the new version beside this one and hands over to Codehouse-Update.exe, which swaps the folders after Codehouse
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
import { MANIFEST_FILE, MOVE_OVER_FILE, STAGED_MARKER } from "./tree.js"
import { compareVersions, isNewer, parseVersion } from "./version.js"
import { macAppWhy } from "./why-mac.js" // Mac fork

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
  /** You chose Update now for this version: Codehouse switches as soon as it is ready, whatever the screen does. */
  applyWhenReady?: string
  lastResult?: UpdateResult
  /**
   * This copy arrived by an old update route (an install made before a rename) and still has to move into its own
   * folder: Codehouse closes, its installer runs by itself, and Codehouse opens again there.
   */
  moveOver?: { phase: "waiting" | "preparing" | "applying" | "failed"; error?: string }
}

/** The folder a copy that arrived by an old route moves into, beside the one it is in. */
export const OWN_FOLDER = "Codehouse"

export interface UpdateServiceOptions {
  /** The folder Codehouse.exe is in. Undefined when Codehouse runs from its source folder. */
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
  #applyWhenReady: string | undefined
  #why: string | undefined
  #busy: Promise<unknown> = Promise.resolve()
  #moveOver: UpdateStatus["moveOver"]

  constructor(o: UpdateServiceOptions) {
    super()
    this.#o = o
    this.#installed = o.installDir ? readInstalled(o.installDir) : undefined
    fs.mkdirSync(o.dir, { recursive: true })
    this.#why = this.#whyNot()
    if (o.installDir && fs.existsSync(path.join(o.installDir, MOVE_OVER_FILE)))
      this.#moveOver = { phase: "waiting" }
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
      return macAppWhy() ?? "Codehouse is running from its source folder. Update it with git pull, or install it with Codehouse-Setup.exe."
    try {
      const probe = `${this.#o.installDir}.write-check`
      fs.mkdirSync(probe, { recursive: true })
      fs.rmSync(probe, { recursive: true, force: true })
    } catch {
      return `Codehouse cannot write next to ${this.#o.installDir}, so it cannot update itself there. Install it with Codehouse-Setup.exe, which puts it in your own Programs folder.`
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
    const event =
      r.mode === "moveover"
        ? r.ok
          ? "update_moved_over"
          : "update_move_over_failed"
        : r.ok
          ? r.mode === "rollback"
            ? "update_rolled_back"
            : "update_installed"
          : "update_failed"
    // A move-over that failed is not tried again by itself, so a problem cannot close Codehouse over and over:
    // Settings, Updates has Finish the move.
    if (r.mode === "moveover" && !r.ok && this.#moveOver)
      this.#moveOver = {
        phase: "failed",
        error: r.reason ?? "The installer did not finish the move.",
      }
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
      ...(this.#applyWhenReady ? { applyWhenReady: this.#applyWhenReady } : {}),
      ...(this.#lastResult ? { lastResult: this.#lastResult } : {}),
      ...(this.#moveOver ? { moveOver: this.#moveOver } : {}),
    }
  }

  #changed(): void {
    this.emit("status", this.status())
  }

  start(): void {
    // A copy that still has to move looks at once, so the move follows straight on from the update that brought it.
    this.#schedule(
      this.#moveOver?.phase === "waiting" ? 3_000 : (this.#o.firstCheckDelayMs ?? 60_000),
    )
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
      if (this.#moveOver?.phase === "waiting") {
        void this.moveOver().catch(() => undefined)
        return this.status()
      }
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
      this.#applyWhenReady = undefined
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
    if (this.#phase === "ready" && this.#applyWhenReady === version) await this.#applyNow(version)
    return this.status()
  }

  /**
   * Update now: switch to this version as soon as it is ready, preparing it first if needed. The Host keeps the
   * choice, so it holds even if the screen reconnects or the dialog is closed while the new version is being built.
   */
  async install(version: string): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    if (this.#phase === "ready" && this.#ready === version) return this.apply(version)
    const l = this.#latest
    if (!l || l.manifest.version !== version)
      throw new UpdateError(
        `Version ${version} is not the newest release. Check for updates again.`,
      )
    this.#applyWhenReady = version
    this.#changed()
    if (this.#phase !== "preparing") void this.prepare(version).catch(() => undefined)
    return this.status()
  }

  async #applyNow(version: string): Promise<void> {
    this.#applyWhenReady = undefined
    try {
      await this.apply(version)
    } catch (e) {
      this.#phase = "failed"
      this.#error = (e as Error).message
      this.#changed()
    }
  }

  /** Switches to the version that is ready. Codehouse closes and Codehouse-Update.exe takes over. */
  async apply(version: string): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    if (this.#phase !== "ready" || this.#ready !== version)
      throw new UpdateError(`Version ${version} is not ready yet.`)
    const updater = updaterIn(this.#staged as string)
    if (!updater)
      throw new UpdateError(
        "The new version has no Codehouse-Update.exe, so it cannot be switched to.",
      )
    await this.#handOver(updater, "apply", this.#staged as string, version)
    return this.status()
  }

  /** Goes back to the version kept beside this one. The version you leave is skipped. */
  async rollback(): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    const prev = this.#previousDir && readInstalled(this.#previousDir)
    if (!prev) throw new UpdateError("There is no earlier version kept to go back to.")
    const updater = updaterIn(this.#o.installDir as string)
    if (!updater) throw new UpdateError("Codehouse-Update.exe is missing from this version.")
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
    const updater = path.join(this.#o.dir, "Codehouse-Update.exe")
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

  /**
   * Finishes moving a copy that arrived by an old update route: downloads the newest release's installer, checks it
   * against the signed description, and hands over to Codehouse-Update.exe, which runs it once Codehouse has closed.
   * The installer installs into the Codehouse folder beside this one, removes this folder and its shortcuts, and
   * starts Codehouse there. Your data is not in either folder.
   */
  async moveOver(): Promise<UpdateStatus> {
    if (!this.#moveOver)
      throw new UpdateError("This copy of Codehouse is already in its own folder.")
    if (this.#moveOver.phase === "preparing" || this.#moveOver.phase === "applying")
      return this.status()
    if (this.#why) throw new UpdateError(this.#why)
    const l = this.#latest
    const inst = l?.manifest.installer
    if (!l || !inst) {
      this.#moveOver = {
        phase: "failed",
        error: l
          ? `Release ${l.manifest.version} has no installer to finish the move with.`
          : "Check for updates first: the move uses the newest release's installer.",
      }
      this.#changed()
      return this.status()
    }
    this.#moveOver = { phase: "preparing" }
    this.#changed()
    try {
      const dl = path.join(this.#o.dir, "downloads", l.manifest.version)
      await fs.promises.mkdir(dl, { recursive: true })
      const setup = path.join(dl, inst.name)
      // A dropped connection is tried again a few times; a file that does not match is refused at once.
      for (let attempt = 1; ; attempt++) {
        try {
          await this.#o.source.download(
            l.manifest.version,
            inst.name,
            { size: inst.size, sha256: inst.sha256 },
            setup,
            () => undefined,
          )
          break
        } catch (e) {
          if (e instanceof UpdateError || attempt >= 4) throw e
          this.#o.log(`installer download dropped (${(e as Error).message}), trying again`)
          await new Promise((r) => setTimeout(r, 2000 * attempt))
        }
      }
      const updater = updaterIn(this.#o.installDir as string)
      if (!updater) throw new UpdateError("Codehouse-Update.exe is missing from this version.")
      await this.#busy
      const copy = path.join(this.#o.dir, "Codehouse-Update.exe")
      fs.copyFileSync(updater, copy)
      const plan = path.join(this.#o.dir, "plan.txt")
      fs.writeFileSync(
        plan,
        [
          "mode=moveover",
          `install=${this.#o.installDir}`,
          `setup=${setup}`,
          `target=${path.join(path.dirname(this.#o.installDir as string), OWN_FOLDER)}`,
          `from=${this.current}`,
          `to=${l.manifest.version}`,
          `health=${path.join(this.#o.dir, "started.json")}`,
          `result=${path.join(this.#o.dir, "result.txt")}`,
          "timeout=300",
          "",
        ].join("\r\n"),
      )
      this.#moveOver = { phase: "applying" }
      this.#changed()
      await this.#o.audit("update_move_over_started", {
        from: this.current,
        to: l.manifest.version,
      })
      this.emit("apply", { updater: copy, plan })
    } catch (e) {
      this.#moveOver = {
        phase: "failed",
        error:
          e instanceof UpdateError
            ? e.message
            : `The move could not start: ${(e as Error).message}`,
      }
      this.#o.log(`move-over not started: ${(e as Error).message}`)
      this.#changed()
    }
    return this.status()
  }

  /** Called once the Host is ready, so Codehouse-Update.exe knows the version it started really works. */
  markStarted(pid: number): void {
    if (!this.#installed) return
    // Only an update waiting for this version reads it, so failing to write it must never stop Codehouse starting.
    try {
      fs.mkdirSync(this.#o.dir, { recursive: true })
      fs.writeFileSync(
        path.join(this.#o.dir, "started.json"),
        JSON.stringify({ version: this.current, pid, at: new Date().toISOString() }) + "\n",
      )
    } catch (e) {
      this.#o.log(`could not record that this version started (${(e as Error).message})`)
    }
  }

  async skip(version: string): Promise<UpdateStatus> {
    if (!parseVersion(version)) throw new UpdateError("That is not a version.")
    const s = this.#o.settings()
    if (!s.skipped.includes(version)) {
      await this.#o.saveSettings({ ...s, skipped: [...s.skipped, version].slice(-50) })
      void this.#o.audit("update_skipped", { version }).catch(() => undefined)
    }
    if (this.#applyWhenReady === version) this.#applyWhenReady = undefined
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

/**
 * The updater in a version's folder.
 */
export function updaterIn(dir: string): string | undefined {
  for (const name of ["Codehouse-Update.exe"]) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  return undefined
}

/** result.txt, written by Codehouse-Update.exe: key=value lines. */
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
