// Types for scripts/leftovers.mjs (O60).
export declare const PROFILE_PREFIXES: string[]
export declare function killTree(pid: number | undefined): void
export declare function ourBrowsers(list?: Array<{ pid: number; parent: number; command: string }>): Array<{ pid: number; profile: string; orphaned: boolean }>
export declare function sweepBrowsers(o?: {
  tmp?: string
  kill?: (pid: number) => void
  list?: Array<{ pid: number; parent: number; command: string }>
  now?: number
}): { stopped: number; removed: number }
