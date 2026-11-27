// Types for scripts/heavy-lock.mjs (O60).
export declare function dataDir(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string
export declare function lockFile(env?: NodeJS.ProcessEnv): string
export interface Holder {
  pid: number
  what: string
  since: string
  cwd?: string
}
export declare function holder(env?: NodeJS.ProcessEnv, now?: number): Holder | undefined
export declare function heavyLock(
  what: string,
  o?: { env?: NodeJS.ProcessEnv; say?: (line: string) => void; wait?: boolean; pollMs?: number },
): Promise<() => void>
