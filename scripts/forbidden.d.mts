export interface ForbiddenCheck {
  id: string
  why: string
  re: RegExp
  /** Files this check does not apply to. */
  except?: string[]
  /** The only files this check applies to. */
  only?: string[]
  files?: RegExp
}
export interface Finding {
  file: string
  line: number
  id: string
  why: string
}
/** Each check, and the only files it does not apply to, each with the reason. */
export const CHECKS: ForbiddenCheck[]
/** Whether a file is checked at all: text that is not a document, not this check and not a skill's reference. */
export function checked(rel: string): boolean
/** Every finding in these files (paths relative to root, with forward slashes). */
export function scan(root: string, files: string[]): Finding[]
/** Every tracked file and every new file git does not ignore. */
export function treeFiles(root: string): string[]
