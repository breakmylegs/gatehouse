import crypto from "node:crypto"
import { allowed, type Range } from "./allowlist.js"

/**
 * Who is signed in to CNW (O41). A sign-in makes a new random session id, kept only as its hash, sent as an HttpOnly,
 * Secure, SameSite=Strict cookie, with a CSRF token the page sends back on every change. Sessions last 12 hours of
 * use, at most 7 days. Five wrong passwords for a name or from an address, then a wait that doubles each time.
 */
export const COOKIE = "cnw_session"
const IDLE_MS = 12 * 3_600_000
const MAX_MS = 7 * 24 * 3_600_000

interface Session {
  user: string
  csrf: string
  created: number
  seen: number
  /** Signed in with a passkey, which the riskiest actions want. */
  passkey: boolean
}

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex")

export class Sessions {
  readonly #byHash = new Map<string, Session>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  start(user: string, passkey: boolean): { id: string; csrf: string } {
    const id = crypto.randomBytes(32).toString("base64url")
    const csrf = crypto.randomBytes(24).toString("base64url")
    const t = this.#now()
    this.#byHash.set(hash(id), { user, csrf, created: t, seen: t, passkey })
    return { id, csrf }
  }

  get(id: string | undefined): Session | undefined {
    if (!id) return undefined
    const s = this.#byHash.get(hash(id))
    if (!s) return undefined
    const t = this.#now()
    if (t - s.seen > IDLE_MS || t - s.created > MAX_MS) {
      this.#byHash.delete(hash(id))
      return undefined
    }
    s.seen = t
    return s
  }

  end(id: string | undefined): void {
    if (id) this.#byHash.delete(hash(id))
  }

  /** Ends every session of a user (a password change, a removed user). */
  endUser(user: string): void {
    for (const [k, s] of this.#byHash) if (s.user === user) this.#byHash.delete(k)
  }
}

/** Five tries for a key (a name, an address), then a wait that doubles: 30 s, 60 s, 120 s... up to an hour. */
export class Throttle {
  readonly #tries = new Map<string, { fails: number; until: number }>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /** Milliseconds to wait before another try, or 0. */
  wait(key: string): number {
    const t = this.#tries.get(key)
    return t ? Math.max(0, t.until - this.#now()) : 0
  }

  failed(key: string): void {
    const t = this.#tries.get(key) ?? { fails: 0, until: 0 }
    t.fails++
    if (t.fails >= 5) t.until = this.#now() + Math.min(3_600_000, 30_000 * 2 ** (t.fails - 5))
    this.#tries.set(key, t)
  }

  succeeded(key: string): void {
    this.#tries.delete(key)
  }
}

/** What a request may do: signed in, from an allow-listed address, or neither. */
export type Access = { kind: "user"; user: string; passkey: boolean; csrf: string } | { kind: "allowlisted" } | { kind: "none" }

export function accessOf(ip: string, sessionId: string | undefined, sessions: Sessions, ranges: readonly Range[]): Access {
  const s = sessions.get(sessionId)
  if (s) return { kind: "user", user: s.user, passkey: s.passkey, csrf: s.csrf }
  if (ranges.length && allowed(ip, ranges)) return { kind: "allowlisted" }
  return { kind: "none" }
}

/**
 * The three things an allow-listed address cannot do without signing in (decided under the standing instruction):
 * change the allow list, remove a computer, and approve a Severe request.
 */
export const NEEDS_SIGN_IN = new Set(["allowlist", "unpair", "severe-approve", "update", "server"])

export function may(access: Access, action: string): boolean {
  if (access.kind === "user") return true
  if (access.kind === "allowlisted") return !NEEDS_SIGN_IN.has(action)
  return false
}

/** Constant-time check of a CSRF token. */
export function csrfOk(access: Access, sent: string | undefined): boolean {
  if (access.kind !== "user") return access.kind === "allowlisted"
  const a = Buffer.from(access.csrf)
  const b = Buffer.from(sent ?? "")
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
