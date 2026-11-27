// Types for scripts/test-shards.mjs (C-001, O60), for the tests that import it.
export declare const PER_FILE_BYTES: number
export declare const RESERVE_BYTES: number
export declare const BATCH: number
export declare function workersFor(freeBytes: number, cpus?: number): number
export declare function listTestFiles(base?: string): string[]
/** O60: how long one process may run before it and all it started are stopped. */
export declare function timeoutMs(env?: NodeJS.ProcessEnv): number
export interface ShardResult {
  failed: string[]
  retried: string[]
  passedOnRetry: string[]
  /** O60: files not started because the time budget ran out. */
  notStarted: number
}
export declare function runShards(
  files: string[],
  o?: {
    freemem?: () => number
    log?: (line: string) => void
    /** One file, or a batch of them when `batch` is over one. */
    run?: ((file: string) => Promise<{ ok: boolean; out: string }>) | ((file: string | string[]) => Promise<{ ok: boolean; out: string }>)
    batch?: number
    /** O60: no file starts after this long. */
    budgetMs?: number
    now?: () => number
    /** O60: told of each file that passed, on its first run or its retry. */
    onPassed?: (file: string) => void
  },
): Promise<ShardResult>
