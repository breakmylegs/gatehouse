import { createHash, timingSafeEqual } from "node:crypto"
import type { IncomingHttpHeaders } from "node:http"

export const MIN_TOKEN_LENGTH = 32
export const MAX_BODY_BYTES = 256 * 1024

export interface GuardOptions {
  token: string
  port: number
}

export type GuardResult =
  { ok: true } | { ok: false; status: number; error: string; headers?: Record<string, string> }

export interface GuardRequest {
  method?: string
  url?: string
  headers: IncomingHttpHeaders
}

/** Constant-time comparison of two secrets of any length (both are hashed first). */
export function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`]
}

function bearer(header: string | string[] | undefined): string | undefined {
  if (typeof header !== "string") return undefined
  const m = /^Bearer ([^\s]+)$/i.exec(header)
  return m?.[1]
}

/**
 * The request guard for the Approver (invariant 7). The order is fixed:
 * Host header, Origin, bearer token, method, path. Body size is enforced while reading the body.
 * Nothing about a failure says which check a probing client got past.
 */
export function checkRequest(req: GuardRequest, opts: GuardOptions): GuardResult {
  const host = req.headers.host
  if (typeof host !== "string" || !allowedHosts(opts.port).includes(host.toLowerCase())) {
    return { ok: false, status: 403, error: "forbidden" }
  }
  // No browser page may talk to this server. Native clients send no Origin at all.
  if (req.headers.origin !== undefined) {
    return { ok: false, status: 403, error: "forbidden" }
  }
  const presented = bearer(req.headers.authorization)
  if (presented === undefined || !secretsEqual(presented, opts.token)) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
      headers: { "www-authenticate": "Bearer" },
    }
  }
  if (req.method !== "POST") {
    return { ok: false, status: 405, error: "method not allowed", headers: { allow: "POST" } }
  }
  const pathname = (req.url ?? "").split("?")[0]
  if (pathname !== "/mcp") {
    return { ok: false, status: 404, error: "not found" }
  }
  return { ok: true }
}

export function assertUsableToken(token: string | undefined): string {
  if (token === undefined || token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`The Approver needs a bearer token of at least ${MIN_TOKEN_LENGTH} characters`)
  }
  return token
}
