// Types for scripts/test-shards.mjs (C-001), for the tests that import it.
export declare const PER_FILE_BYTES: number
export declare const RESERVE_BYTES: number
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
    run?: (file: string) => Promise<{ ok: boolean; out: string }>
  },
): Promise<ShardResult>
