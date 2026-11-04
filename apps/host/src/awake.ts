/**
 * Keep the computer awake while a session works (owner, 4 Nov, after Claude's desktop app), so a long build is not cut
 * off when Windows would go to sleep. The display can still turn off and closing the lid still sleeps. The Host tells
 * the window app whenever the answer changes; the window asks Windows not to sleep (SetThreadExecutionState).
 */
export class AwakeWatch {
  readonly #working = new Set<string>()
  readonly #enabled: () => boolean
  readonly #tell: (on: boolean) => void
  #on = false

  constructor(enabled: () => boolean, tell: (on: boolean) => void) {
    this.#enabled = enabled
    this.#tell = tell
  }

  /** A session's state changed: running or waiting on you counts as working. */
  note(info: { id: string; state: string }): void {
    if (info.state === "running" || info.state === "waiting") this.#working.add(info.id)
    else this.#working.delete(info.id)
    this.check()
  }

  /** Tells the window when the answer changed: also after the setting changes. */
  check(): void {
    const on = this.#enabled() && this.#working.size > 0
    if (on === this.#on) return
    this.#on = on
    this.#tell(on)
  }

  get on(): boolean {
    return this.#on
  }
}
