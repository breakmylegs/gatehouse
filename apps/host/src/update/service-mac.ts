/**
 * Mac fork (owner, 18 Nov: the Mac in-app updater): updates for Codehouse.app, with the same face as UpdateService
 * (service.ts) so Settings, Updates and the API are the same on both. It looks at the mac-channel release every so
 * often, checks the signature against the Mac keys, builds the new app in Codehouse's updates folder (stage-mac.ts),
 * and on your word hands over to packaging/mac/codehouse-update.sh: the window app starts it and quits; it swaps the
 * apps, opens the new one, and puts the old one back if the new one has not started within four minutes.
 *
 *   <updates>/mac-next/Codehouse.app       the version built and checked, ready to switch to
 *   <updates>/mac-previous/Codehouse.app   the one before, kept so an update can be undone from Settings
 */
import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { UPDATE_INTERVALS } from "@gatehouse/shared/node"
import { MAC_RELEASE_KEYS, compareMacVersions, isMacVersion, verifyMacRelease, type MacManifest } from "./release-mac.js"
import { parseResult, type UpdateResult, type UpdateSettings, type UpdateStatus } from "./service.js"
import { UpdateError, type UpdateSource } from "./source.js"
import { MAC_APP, stageMacRelease } from "./stage-mac.js"
import type { StageProgress } from "./stage.js"
import { STAGED_MARKER } from "./tree.js"

/** The updater inside every Codehouse.app (scripts/package-mac.mjs puts it there). */
export const MAC_UPDATER = "Contents/Resources/codehouse-update.sh"

export interface MacUpdateOptions {
  /** The running Codehouse.app (GATEHOUSE_MAC_APP_PATH, from packaging/mac/Host.swift). */
  app: string
  /** Its version (GATEHOUSE_MAC_APP_VERSION). */
  version: string
  /** ~/Library/Application Support/Gatehouse/updates */
  dir: string
  source: UpdateSource
  keys?: readonly string[]
  arch?: string
  settings: () => UpdateSettings
  saveSettings: (s: UpdateSettings) => Promise<void>
  audit: (event: string, input: Record<string, unknown>) => Promise<void>
  log: (line: string) => void
  tokenSet?: () => boolean
  firstCheckDelayMs?: number
  stage?: typeof stageMacRelease
  now?: () => Date
}

/** The version an app's Info.plist says it is (CodehouseVersion, written by scripts/package-mac.mjs). */
export function appVersion(app: string): string | undefined {
  try {
    const plist = fs.readFileSync(path.join(app, "Contents", "Info.plist"), "utf8")
    const v = /<key>CodehouseVersion<\/key>\s*<string>([^<]{1,60})<\/string>/.exec(plist)?.[1]
    return v && isMacVersion(v) ? v : undefined
  } catch {
    return undefined
  }
}

const newer = (a: string, b: string) => isMacVersion(a) && isMacVersion(b) && compareMacVersions(a, b) > 0

export class MacUpdateService extends EventEmitter<{
  status: [UpdateStatus]
  apply: [{ updater: string; plan: string }]
}> {
  readonly #o: MacUpdateOptions
  #timer: NodeJS.Timeout | undefined
  #checking = false
  #lastCheck: string | undefined
  #nextCheck: string | undefined
  #checkError: string | undefined
  #latest: { manifest: MacManifest; bytes: Buffer; signature: string } | undefined
  #phase: UpdateStatus["phase"] = "idle"
  #progress: StageProgress | undefined
  #error: string | undefined
  #ready: string | undefined
  #lastResult: UpdateResult | undefined
  #applyWhenReady: string | undefined
  #why: string | undefined
  #busy: Promise<unknown> = Promise.resolve()

  constructor(o: MacUpdateOptions) {
    super()
    this.#o = o
    fs.mkdirSync(o.dir, { recursive: true })
    this.#why = this.#whyNot()
    this.#readResult()
    const marker = path.join(this.#next, STAGED_MARKER)
    if (fs.existsSync(marker)) {
      const v = fs.readFileSync(marker, "utf8").trim()
      if (newer(v, this.current)) {
        this.#ready = v
        this.#phase = "ready"
      }
    }
  }

  get current(): string {
    return this.#o.version
  }

  get #next(): string {
    return path.join(this.#o.dir, "mac-next")
  }

  get #previous(): string {
    return path.join(this.#o.dir, "mac-previous", MAC_APP)
  }

  #whyNot(): string | undefined {
    const app = this.#o.app
    if (!isMacVersion(this.current))
      return `This Codehouse.app (${this.current}) was not built as a Mac release, so it does not update itself. Install a newer Codehouse.app over it.`
    if (app.includes("/AppTranslocation/"))
      return "macOS is running Codehouse from a temporary copy, because it was opened where it was downloaded. Move Codehouse.app to your Applications folder and open it from there, and it can update itself."
    try {
      fs.accessSync(path.dirname(app), fs.constants.W_OK)
      fs.accessSync(app, fs.constants.W_OK)
    } catch {
      return `Codehouse cannot replace itself in ${path.dirname(app)}. Move Codehouse.app to your own Applications folder (in your home folder), and it can update itself there.`
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
    const event = r.ok ? (r.mode === "rollback" ? "update_rolled_back" : "update_installed") : "update_failed"
    void this.#o.audit(event, { from: r.from, to: r.to, reason: r.reason }).catch(() => undefined)
    // A version that would not start here is not offered again until a newer one comes out.
    if (!r.ok && r.to && r.mode === "apply") void this.skip(r.to).catch(() => undefined)
  }

  status(): UpdateStatus {
    const s = this.#o.settings()
    const latest = this.#latest?.manifest
    const prev = appVersion(this.#previous)
    return {
      current: this.current,
      kind: "release",
      canInstall: this.#why === undefined,
      ...(this.#why ? { why: this.#why } : {}),
      ...(prev ? { previous: prev } : {}),
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
      available: !!latest && newer(latest.version, this.current) && !s.skipped.includes(latest.version),
      phase: this.#phase,
      ...(this.#progress ? { progress: this.#progress } : {}),
      ...(this.#error ? { error: this.#error } : {}),
      ...(this.#ready ? { ready: this.#ready } : {}),
      ...(this.#applyWhenReady ? { applyWhenReady: this.#applyWhenReady } : {}),
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

  /** Looks for a new Mac release now. Never throws: a failure is shown, and the next check tries again. */
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
      const v = verifyMacRelease(got.bytes, got.signature, this.#o.keys ?? MAC_RELEASE_KEYS, this.#o.arch)
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
      this.#checkError = e instanceof UpdateError ? e.message : `Could not reach GitHub: ${(e as Error).message}`
    } finally {
      this.#checking = false
      this.#changed()
    }
    return this.status()
  }

  /** Builds the given version in the updates folder. It must be the newest release found by the last check. */
  async prepare(version: string): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    const l = this.#latest
    if (!l || l.manifest.version !== version)
      throw new UpdateError(`Version ${version} is not the newest release. Check for updates again.`)
    if (!newer(version, this.current)) throw new UpdateError(`Version ${version} is not newer than ${this.current}.`)
    if (this.#phase === "preparing" || this.#phase === "applying") return this.status()
    if (this.#phase === "ready" && this.#ready === version) return this.status()
    this.#phase = "preparing"
    this.#error = undefined
    this.#ready = undefined
    this.#changed()
    const run = (this.#o.stage ?? stageMacRelease)({
      manifest: l.manifest,
      manifestBytes: l.bytes,
      signature: l.signature,
      app: this.#o.app,
      nextDir: this.#next,
      downloadsDir: path.join(this.#o.dir, "downloads"),
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
      this.#error = e instanceof UpdateError ? e.message : `The update could not be prepared: ${(e as Error).message}`
      this.#o.log(`update ${version} not prepared: ${(e as Error).message}`)
      await fs.promises.rm(this.#next, { recursive: true, force: true }).catch(() => undefined)
    } finally {
      this.#changed()
    }
    if (this.#phase === "ready" && this.#applyWhenReady === version) {
      this.#applyWhenReady = undefined
      await this.apply(version).catch((e: Error) => {
        this.#phase = "failed"
        this.#error = e.message
        this.#changed()
      })
    }
    return this.status()
  }

  /** Update now: switch as soon as it is ready, preparing it first if need be. */
  async install(version: string): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    if (this.#phase === "ready" && this.#ready === version) return this.apply(version)
    const l = this.#latest
    if (!l || l.manifest.version !== version)
      throw new UpdateError(`Version ${version} is not the newest release. Check for updates again.`)
    this.#applyWhenReady = version
    this.#changed()
    if (this.#phase !== "preparing") void this.prepare(version).catch(() => undefined)
    return this.status()
  }

  /** Switches to the version that is ready: Codehouse quits and the new version's updater takes over. */
  async apply(version: string): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    if (this.#phase !== "ready" || this.#ready !== version) throw new UpdateError(`Version ${version} is not ready yet.`)
    const candidate = path.join(this.#next, MAC_APP)
    await this.#handOver(path.join(candidate, MAC_UPDATER), "apply", candidate, version)
    return this.status()
  }

  /** Goes back to the version kept from before. The version you leave is skipped. */
  async rollback(): Promise<UpdateStatus> {
    if (this.#why) throw new UpdateError(this.#why)
    const prev = appVersion(this.#previous)
    if (!prev) throw new UpdateError("There is no earlier version kept to go back to.")
    await this.skip(this.current)
    await this.#handOver(path.join(this.#o.app, MAC_UPDATER), "rollback", this.#previous, prev)
    return this.status()
  }

  async #handOver(updaterSrc: string, mode: "apply" | "rollback", candidate: string, to: string): Promise<void> {
    await this.#busy
    if (!fs.existsSync(updaterSrc)) throw new UpdateError("The updater is missing from Codehouse.app, so it cannot switch versions.")
    // A copy in the updates folder: the app it came from is moved while it runs. The window app runs only this one.
    const updater = path.join(this.#o.dir, "codehouse-update.sh")
    fs.copyFileSync(updaterSrc, updater)
    const plan = path.join(this.#o.dir, "plan.txt")
    fs.writeFileSync(
      plan,
      [
        `mode=${mode}`,
        `app=${this.#o.app}`,
        `candidate=${candidate}`,
        `previous=${this.#previous}`,
        `from=${this.current}`,
        `to=${to}`,
        `health=${path.join(this.#o.dir, "started.json")}`,
        `result=${path.join(this.#o.dir, "result.txt")}`,
        "timeout=240",
        "",
      ].join("\n"),
    )
    this.#phase = "applying"
    this.#changed()
    await this.#o.audit(mode === "apply" ? "update_started" : "update_rollback_started", { from: this.current, to })
    this.emit("apply", { updater, plan })
  }

  /** Windows' move to its own folder; a Mac app has nothing to move. */
  async moveOver(): Promise<UpdateStatus> {
    throw new UpdateError("This copy of Codehouse is already in its own place.")
  }

  /** Called once the Host is ready, so the updater knows the version it opened really works. */
  markStarted(pid: number): void {
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
    if (!isMacVersion(version)) throw new UpdateError("That is not a version.")
    const s = this.#o.settings()
    if (!s.skipped.includes(version)) {
      await this.#o.saveSettings({ ...s, skipped: [...s.skipped, version].slice(-50) })
      void this.#o.audit("update_skipped", { version }).catch(() => undefined)
    }
    if (this.#applyWhenReady === version) this.#applyWhenReady = undefined
    if (this.#ready === version && this.#phase === "ready") {
      this.#ready = undefined
      this.#phase = "idle"
      await fs.promises.rm(this.#next, { recursive: true, force: true }).catch(() => undefined)
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
    if (p.checkEveryMinutes !== undefined && !(UPDATE_INTERVALS as readonly number[]).includes(p.checkEveryMinutes))
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

  /** Leftovers: a half-built next version and downloads of versions not newer than this one. Best effort. */
  async #cleanUp(): Promise<void> {
    try {
      if (fs.existsSync(this.#next) && !this.#ready && this.#phase === "idle")
        await fs.promises.rm(this.#next, { recursive: true, force: true })
      const dl = path.join(this.#o.dir, "downloads")
      if (fs.existsSync(dl))
        for (const v of await fs.promises.readdir(dl))
          if (v !== this.#ready && (!isMacVersion(v) || compareMacVersions(v, this.current) <= 0))
            await fs.promises.rm(path.join(dl, v), { recursive: true, force: true })
    } catch {
      // Leftovers only cost disk space.
    }
  }
}
