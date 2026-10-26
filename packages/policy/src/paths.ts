import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface ResolvedPath {
  raw: string
  /** Absolute path in the platform's own form. For UNC and device paths, the normalised raw text. */
  abs: string
  /** Lower-case, forward-slash comparison key. */
  key: string
  unc: boolean
  device: boolean
  /** True when the path contains an expansion that was replaced by a placeholder. */
  dynamic: boolean
}

export const DYNAMIC_PLACEHOLDER = "__dyn__"

/** Forward slashes, Git Bash drive prefixes (/c/dev) turned into C:/dev, no trailing separator. */
export function normaliseRaw(raw: string): string {
  let p = raw.replace(/\\/g, "/")
  const gitBash = /^\/([a-zA-Z])(\/|$)/.exec(p)
  if (gitBash && gitBash[1]) p = `${gitBash[1].toUpperCase()}:/${p.slice(3)}`
  const mnt = /^\/mnt\/([a-zA-Z])(\/|$)/.exec(p)
  if (mnt && mnt[1]) p = `${mnt[1].toUpperCase()}:/${p.slice(7)}`
  return p
}

export function toKey(abs: string): string {
  let k = abs.replace(/\\/g, "/").toLowerCase()
  while (k.length > 3 && k.endsWith("/")) k = k.slice(0, -1)
  return k
}

/**
 * Windows ignores trailing dots and spaces in a path segment and treats `name:stream`
 * as an alternate data stream of `name`. Strip both so `.env.` and `.env::$DATA` name `.env`.
 */
function cleanSegment(seg: string): string {
  if (seg === "." || seg === "..") return seg
  let s = seg
  const colon = s.indexOf(":")
  if (colon > 0) s = s.slice(0, colon)
  return s.replace(/[. ]+$/, "")
}

function isDevicePrefix(p: string): boolean {
  return /^\/\/[?.](\/|$)/.test(p)
}

function realOrUndefined(p: string): string | undefined {
  try {
    return fs.realpathSync.native(p)
  } catch {
    return undefined
  }
}

/** Real path of an existing path, or the real path of its nearest existing ancestor plus the rest. */
function realWithMissingTail(abs: string): string {
  const direct = realOrUndefined(abs)
  if (direct !== undefined) return direct
  const tail: string[] = []
  let cur = abs
  for (let i = 0; i < 64; i++) {
    const parent = path.dirname(cur)
    if (parent === cur) break
    tail.unshift(path.basename(cur))
    const real = realOrUndefined(parent)
    if (real !== undefined) return path.join(real, ...tail)
    cur = parent
  }
  return abs
}

/** Resolves `..` physically (after following links), the way Windows does. */
function walkWithDotDot(startReal: string, segments: string[]): string {
  let cur = startReal
  let i = 0
  for (; i < segments.length; i++) {
    const seg = cleanSegment(segments[i] ?? "")
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      cur = path.dirname(cur)
      continue
    }
    const real = realOrUndefined(path.join(cur, seg))
    if (real === undefined) {
      break
    }
    cur = real
  }
  for (; i < segments.length; i++) {
    const seg = cleanSegment(segments[i] ?? "")
    if (seg === "" || seg === ".") continue
    cur = seg === ".." ? path.dirname(cur) : path.join(cur, seg)
  }
  return cur
}

export interface ResolveOptions {
  /** Resolve a path that does not exist to its nearest existing ancestor. Default true. */
  missingTail?: boolean
}

export function resolvePath(
  raw: string,
  cwd: string,
  dynamic = false,
  opts: ResolveOptions = {},
): ResolvedPath {
  let text = raw
  if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) {
    text = os.homedir() + text.slice(1)
  }
  const norm = normaliseRaw(text)

  if (isDevicePrefix(norm)) {
    return { raw, abs: norm, key: toKey(norm), unc: false, device: true, dynamic }
  }
  if (norm.startsWith("//")) {
    return { raw, abs: norm, key: toKey(norm), unc: true, device: false, dynamic }
  }

  const absolute = /^[a-zA-Z]:\//.test(norm) || norm.startsWith("/")
  const base = absolute ? "" : cwd
  const segments = (absolute ? norm : norm).split("/")
  let startReal: string
  let rest: string[]
  if (absolute) {
    const drive = /^[a-zA-Z]:/.exec(norm)
    startReal = drive ? drive[0] + path.sep : path.sep
    rest = norm.slice(drive ? 3 : 1).split("/")
  } else {
    startReal = realOrUndefined(base) ?? path.resolve(base)
    rest = segments
  }

  const needsWalk = rest.some((s) => cleanSegment(s) === "..")
  let abs: string
  if (needsWalk) {
    abs = walkWithDotDot(startReal, rest)
  } else {
    const cleaned = rest.map(cleanSegment).filter((s) => s !== "" && s !== ".")
    const lexical = path.join(startReal, ...cleaned)
    abs = opts.missingTail === false ? (realOrUndefined(lexical) ?? lexical) : realWithMissingTail(lexical)
  }
  return { raw, abs, key: toKey(abs), unc: false, device: false, dynamic }
}

/**
 * Resolves a word to a comparison key without touching the file system. Used by the floor, which
 * must look at every word of a command cheaply. Applies the same Windows clean-up as resolvePath.
 */
export function lexicalResolve(raw: string, cwd: string): ResolvedPath {
  let text = raw
  if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) {
    text = os.homedir() + text.slice(1)
  }
  const norm = normaliseRaw(text)
  if (isDevicePrefix(norm)) {
    return { raw, abs: norm, key: toKey(norm), unc: false, device: true, dynamic: false }
  }
  if (norm.startsWith("//")) {
    return { raw, abs: norm, key: toKey(norm), unc: true, device: false, dynamic: false }
  }
  const absolute = /^[a-zA-Z]:\//.test(norm) || norm.startsWith("/")
  const joined = absolute ? norm : normaliseRaw(cwd) + "/" + norm
  const drive = /^[a-zA-Z]:/.exec(joined)
  const prefix = drive ? drive[0] : ""
  const parts: string[] = []
  for (const piece of joined.slice(prefix.length).split("/")) {
    const seg = cleanSegment(piece)
    if (seg === "" || seg === ".") continue
    if (seg === "..") parts.pop()
    else parts.push(seg)
  }
  const abs = prefix + "/" + parts.join("/")
  return { raw, abs, key: toKey(abs), unc: false, device: false, dynamic: false }
}

export function isInside(key: string, rootKey: string): boolean {
  if (key === rootKey) return true
  const prefix = rootKey.endsWith("/") ? rootKey : rootKey + "/"
  return key.startsWith(prefix)
}

/** Path of key relative to rootKey, or null when outside. */
export function relativeTo(key: string, rootKey: string): string | null {
  if (!isInside(key, rootKey)) return null
  const prefix = rootKey.endsWith("/") ? rootKey : rootKey + "/"
  return key === rootKey ? "" : key.slice(prefix.length)
}

const rootCache = new Map<string, { root: string; at: number }>()
const ROOT_TTL_MS = 5000

/** Git root of cwd (the nearest ancestor holding a .git entry), else cwd itself. */
export function findProjectRoot(cwd: string): string {
  const now = Date.now()
  const hit = rootCache.get(cwd)
  if (hit && now - hit.at < ROOT_TTL_MS) return hit.root
  let cur = realOrUndefined(cwd) ?? path.resolve(cwd)
  const start = cur
  let found = start
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(cur, ".git"))) {
      found = cur
      break
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  rootCache.set(cwd, { root: found, at: now })
  return found
}

export function clearPathCaches(): void {
  rootCache.clear()
}

export function realKey(p: string): string {
  return toKey(realOrUndefined(p) ?? path.resolve(p))
}
