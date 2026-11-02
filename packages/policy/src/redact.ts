const BUILT_IN: { kind: string; re: RegExp }[] = [
  {
    kind: "private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  { kind: "authorization", re: /\b(Authorization\s*[:=]\s*)(?:Bearer|Basic|Token|Digest)?\s*[^\s"',;]+/gi },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g },
  { kind: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{8,}/g },
  { kind: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { kind: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "google-key", re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { kind: "url-credentials", re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi },
  {
    kind: "connection-string",
    re: /\b(?:Server|Data Source|Host|Endpoint|AccountEndpoint|DefaultEndpointsProtocol)\s*=[^\n]*?(?:Password|Pwd|AccountKey|SharedAccessKey|Secret)\s*=[^;\s"']+;?/gi,
  },
  {
    kind: "secret-assignment",
    re: /\b([A-Za-z0-9_.-]*(?:api[_-]?key|apikey|secret|token|passwd|password|pwd|access[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)(\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"',;&]+)/gi,
  },
]

const SECRET_KEY = /(?:api[_-]?key|apikey|secret|token|passwd|password|pwd|authorization|credential|private[_-]?key)/i

export interface RedactOptions {
  /** Client names, internal host names and the like. Matched case-insensitively as plain text. */
  terms?: readonly string[]
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function redactString(text: string, opts: RedactOptions = {}): string {
  let out = text
  for (const { kind, re } of BUILT_IN) {
    re.lastIndex = 0
    if (kind === "authorization") out = out.replace(re, (_m, head: string) => `${head}[REDACTED:${kind}]`)
    else if (kind === "url-credentials") out = out.replace(re, (_m, scheme: string) => `${scheme}[REDACTED:${kind}]@`)
    else if (kind === "secret-assignment") {
      out = out.replace(re, (_m, key: string, sep: string) => `${key}${sep}[REDACTED:${kind}]`)
    } else out = out.replace(re, `[REDACTED:${kind}]`)
  }
  for (const term of opts.terms ?? []) {
    const t = term.trim()
    if (t === "") continue
    out = out.replace(new RegExp(escapeRegExp(t), "gi"), "[REDACTED:term]")
  }
  return out
}

/** Redacts every string in a JSON-like value and every value under a secret-looking key. Pure. */
export function redact<T>(value: T, opts: RedactOptions = {}): T {
  return walk(value, opts, new WeakSet<object>()) as T
}

function walk(value: unknown, opts: RedactOptions, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value, opts)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return "[REDACTED:cycle]"
  seen.add(value)
  if (Array.isArray(value)) return value.map((v) => walk(v, opts, seen))
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      SECRET_KEY.test(key) && typeof v === "string"
        ? "[REDACTED:secret-key]"
        : walk(v, opts, seen)
  }
  return out
}
