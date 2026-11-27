// Types for scripts/job-headroom.mjs (O60).
export interface Headroom {
  job: string
  limitMb: number
  usedMb: number
  peakMb?: number
}
export declare const LEVEL_MB: Array<[string, number]>
export declare const LEVEL_NAME: Record<string, string>
export declare function levelOf(mb: number): string
export declare function levelFor(needMb: number, usedMb: number): string
export declare function jobHeadroom(pid?: number, run?: unknown): Headroom | undefined
export declare function fits(needMb: number, h: Headroom | undefined): { ok: boolean; free?: number; message?: string }
