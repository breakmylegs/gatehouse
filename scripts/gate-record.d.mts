// Types for scripts/gate-record.mjs (O60).
export interface GateRecord {
  commit: string
  passed: string[]
  steps: string[]
  complete: boolean
  started?: string
  updated?: string
}
export declare function gateRecord(commit: string, env?: NodeJS.ProcessEnv): GateRecord | undefined
export declare function notePassed(commit: string, file: string, env?: NodeJS.ProcessEnv): void
export declare function noteStep(commit: string, step: string, env?: NodeJS.ProcessEnv): void
export declare function noteComplete(commit: string, env?: NodeJS.ProcessEnv): void
export declare function pruneRecords(env?: NodeJS.ProcessEnv, now?: number): void
