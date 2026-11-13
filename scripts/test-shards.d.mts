// Types for scripts/test-shards.mjs (C-001), for the tests that import it.
export declare const PER_FILE_BYTES: number
export declare const RESERVE_BYTES: number
export declare const BATCH: number
export declare function workersFor(freeBytes: number, cpus?: number): number
export declare function listTestFiles(base?: string): string[]
export interface ShardResult {
  failed: string[]
  retried: string[]
  passedOnRetry: string[]
}
export declare function runShards(
  files: string[],
  o?: {
    freemem?: () => number
    log?: (line: string) => void
    /** One file, or a batch of them when `batch` is over one. */
    run?: ((file: string) => Promise<{ ok: boolean; out: string }>) | ((file: string | string[]) => Promise<{ ok: boolean; out: string }>)
    batch?: number
  },
): Promise<ShardResult>
