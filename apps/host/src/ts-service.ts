import { Worker } from "node:worker_threads"

/**
 * C-032 (frontier, Wave 3): TypeScript's own language service for the file view: what is wrong with a file
 * (diagnostics), what a name is (shown as text beside the code, never a hover tooltip), where it is defined, and where it
 * is used. It runs in a worker thread with a memory cap; past the cap (or on any crash) the worker ends, what it was
 * asked fails with a plain reason, and the next question starts a new worker. TypeScript is pinned in the Host's own
 * dependencies (the version the repository builds with), because the packaged app installs only those.
 */
export type TsOp = "diagnostics" | "info" | "definition" | "references"

export interface TsServiceOptions {
  /** The worker's memory cap, in MB of its old generation. */
  memoryMb?: number
  /** How long one question may take. */
  timeoutMs?: number
  /** The worker's script; for tests. */
  script?: URL
  log?: (line: string) => void
}

export class TsService {
  #worker: Worker | undefined
  #next = 0
  readonly #waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  /** How many times a worker ended and was started again (shown in Doctor later, and in tests). */
  restarts = 0
  readonly #o: TsServiceOptions

  constructor(o: TsServiceOptions = {}) {
    this.#o = o
  }

  #start(): Worker {
    const w = new Worker(this.#o.script ?? new URL("./ts-worker.mjs", import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: this.#o.memoryMb ?? 768 },
    })
    w.on("message", (m: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const p = this.#waiting.get(m.id)
      if (!p) return
      clearTimeout(p.timer)
      this.#waiting.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error ?? "The language service could not answer."))
    })
    const ended = (why: string) => {
      if (this.#worker !== w) return
      this.#worker = undefined
      this.restarts++
      this.#o.log?.(`typescript: the language service ended (${why}); the next question starts it again`)
      for (const [id, p] of this.#waiting) {
        clearTimeout(p.timer)
        p.reject(new Error(`The TypeScript language service stopped (${why}) and starts again on the next look.`))
        this.#waiting.delete(id)
      }
    }
    w.on("error", (e: Error & { code?: string }) => ended(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "it used more memory than its cap" : e.message))
    w.on("exit", (code) => ended(`it exited with ${code}`))
    w.unref()
    return w
  }

  /** One question about a file in a project folder. */
  ask(op: TsOp, root: string, file: string, pos = 0): Promise<unknown> {
    const w = (this.#worker ??= this.#start())
    const id = ++this.#next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id)
        reject(new Error("The TypeScript language service did not answer in time."))
      }, this.#o.timeoutMs ?? 30_000)
      this.#waiting.set(id, { resolve, reject, timer })
      w.postMessage({ id, op, root, file, pos })
    })
  }

  async close(): Promise<void> {
    const w = this.#worker
    this.#worker = undefined
    if (w) await w.terminate()
  }
}
