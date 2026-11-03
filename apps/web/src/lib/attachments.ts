/**
 * Files you attach are saved in the session's folder under .codehouse/attachments and named to Claude with @ and that
 * path. On screen they are an icon each, not the path (owner, 3 Nov: "I only want to see an icon and not this sort of
 * text"), in the prompt box and in what you sent, live or read back after a restart.
 */
const MENTION = /(^|\s)@(\.codehouse\/attachments\/[^\s]+)/g

export interface AttachedFile {
  /** Its path in the session's folder, as Claude is told it. */
  rel: string
  /** Its own name, without the few letters added to keep it apart from another of the same name. */
  name: string
}

/** The name a person gave the file: "ab12cd-notes.txt" is notes.txt. */
export function attachedName(rel: string): string {
  const base = rel.split("/").at(-1) ?? rel
  return base.replace(/^[0-9a-f]{6}-/, "") || base
}

/** What you wrote without the attachment mentions, and the files they name, in order. */
export function splitAttachments(text: string): { words: string; files: AttachedFile[] } {
  const files: AttachedFile[] = []
  const words = text
    .replace(MENTION, (_m, lead: string, rel: string) => {
      files.push({ rel, name: attachedName(rel) })
      return lead
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim()
  return { words, files }
}

/**
 * A path inside the session's folder, relative to it with forward slashes, or undefined for one outside it. Windows
 * paths compare without case, as Windows does.
 */
export function relInside(cwd: string, file: string): string | undefined {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "")
  const root = norm(cwd)
  const abs = norm(file)
  if (!/^[A-Za-z]:\//.test(abs) && !abs.startsWith("/"))
    return abs.split("/").includes("..") ? undefined : abs
  if (abs.toLowerCase().startsWith(root.toLowerCase() + "/")) {
    const rel = abs.slice(root.length + 1)
    return rel.split("/").includes("..") ? undefined : rel
  }
  return undefined
}

/** "TXT", "ZIP": the kind of file, for the corner of its icon. Nothing for a name with no extension. */
export const extensionOf = (name: string): string => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name)
  return m ? m[1]!.toUpperCase() : ""
}
