import {
  createCheckpoint,
  listCheckpoints,
  previewRestore,
  restoreCheckpoint,
  type Checkpoint,
  type RestorePreview,
  type RestoreResult,
} from "@gatehouse/shared/node"
import { secretGlobs, type Policy } from "@gatehouse/policy"
import type { GatehouseConfig } from "@gatehouse/shared/node"

export const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

export interface CheckpointManagerOptions {
  config: () => GatehouseConfig
  policy: () => Policy | undefined
  log: (line: string) => void
  now?: () => number
}

/**
 * Takes git checkpoints at the moments the spec names: before a call is escalated to a person, and before
 * the first edit after a quiet spell (an edit burst). It never throws: a project that is not a git repository,
 * or a git failure, is logged and the session carries on without one. Secrets files are never copied into a
 * checkpoint, using the floor's own globs. With no policy loaded nothing is captured, because the globs
 * cannot be known.
 */
export class CheckpointManager {
  readonly #opts: CheckpointManagerOptions
  readonly #lastEdit = new Map<string, number>()

  constructor(opts: CheckpointManagerOptions) {
    this.#opts = opts
  }

  #excludes(): string[] | undefined {
    const policy = this.#opts.policy()
    return policy ? secretGlobs(policy) : undefined
  }

  async #take(sessionId: string, cwd: string, label: string): Promise<Checkpoint | undefined> {
    const excludeGlobs = this.#excludes()
    if (!excludeGlobs) {
      this.#opts.log("no checkpoint: no policy is loaded, so secrets cannot be excluded")
      return undefined
    }
    try {
      return await createCheckpoint({ cwd, sessionId, label, excludeGlobs })
    } catch (e) {
      this.#opts.log(`no checkpoint: ${(e as Error).message}`)
      return undefined
    }
  }

  /** Before an escalated call (if the setting is on). */
  async beforeEscalation(sessionId: string, cwd: string, what: string): Promise<Checkpoint | undefined> {
    if (!this.#opts.config().checkpoints.beforeEscalation) return undefined
    return this.#take(sessionId, cwd, `before: ${what}`)
  }

  /** Before an edit tool runs. Takes one checkpoint at the start of a burst of edits. */
  async noteEdit(sessionId: string, cwd: string, tool: string): Promise<Checkpoint | undefined> {
    if (!EDIT_TOOLS.has(tool)) return undefined
    const cfg = this.#opts.config().checkpoints
    const now = (this.#opts.now ?? Date.now)()
    const last = this.#lastEdit.get(sessionId)
    this.#lastEdit.set(sessionId, now)
    if (!cfg.editBursts) return undefined
    if (last !== undefined && now - last < cfg.burstWindowMs) return undefined
    return this.#take(sessionId, cwd, "before a burst of edits")
  }

  list(cwd: string, sessionId?: string): Promise<Checkpoint[]> {
    return listCheckpoints(cwd, sessionId)
  }

  preview(cwd: string, ref: string): Promise<RestorePreview> {
    return previewRestore(cwd, ref, this.#excludes())
  }

  /** Needs `confirm: true`, which the UI sets only after showing the preview. */
  restore(cwd: string, ref: string, sessionId: string, confirm: boolean): Promise<RestoreResult> {
    return restoreCheckpoint({ cwd, ref, sessionId, confirm, excludeGlobs: this.#excludes() })
  }
}
