import picomatch from "picomatch"

const wildcardCache = new Map<string, RegExp>()

/**
 * Compiles a Gatehouse wildcard to an anchored regular expression.
 * `*` matches any run of characters (including spaces and slashes). Everything else is literal.
 */
export function wildcardToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
  const key = (caseInsensitive ? "i:" : "s:") + pattern
  const hit = wildcardCache.get(key)
  if (hit) return hit
  const body = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  const re = new RegExp(`^${body}$`, caseInsensitive ? "is" : "s")
  wildcardCache.set(key, re)
  return re
}

export function matchWildcard(pattern: string, text: string, caseInsensitive: boolean): boolean {
  return wildcardToRegExp(pattern, caseInsensitive).test(text)
}

export function matchAnyWildcard(
  patterns: readonly string[],
  text: string,
  caseInsensitive: boolean,
): boolean {
  return patterns.some((p) => matchWildcard(p, text, caseInsensitive))
}

const globCache = new Map<string, (input: string) => boolean>()

/** Case-insensitive path glob matcher over forward-slash paths. Dot files match. */
export function compileGlobs(globs: readonly string[]): (key: string) => boolean {
  const cacheKey = JSON.stringify(globs)
  const hit = globCache.get(cacheKey)
  if (hit) return hit
  // Parentheses are literal in Gatehouse globs ("C:/Program Files (x86)/**"), so escape them
  // before picomatch can read them as a group.
  const escaped = globs.map((g) => g.replace(/[()]/g, "\\$&"))
  const matcher = picomatch(escaped, { dot: true, nocase: true, windows: false, noextglob: true })
  const fn = (key: string) => matcher(key) || matcher(key.endsWith("/") ? key : key + "/")
  globCache.set(cacheKey, fn)
  return fn
}
