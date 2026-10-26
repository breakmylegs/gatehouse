import { createHash, timingSafeEqual } from "node:crypto"
import type { IncomingHttpHeaders } from "node:http"
import { WS_SUBPROTOCOL, WS_TOKEN_PREFIX } from "@gatehouse/shared"

export interface HostGuardOptions {
  token: string
  port: number
}

export type HostGuardResult = { ok: true } | { ok: false; status: number; error: string }

export function secretsEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest())
}

export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`]
}

/** The only origins a browser page may use to reach the Host: the Host's own. */
export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
}

/** The token from `Authorization: Bearer ...` or from a `token.<value>` WebSocket subprotocol entry. */
export function extractToken(headers: IncomingHttpHeaders): string | undefined {
  const auth = headers.authorization
  if (typeof auth === "string") {
    const m = /^Bearer ([^\s]+)$/i.exec(auth)
    if (m?.[1]) return m[1]
  }
  const proto = headers["sec-websocket-protocol"]
  if (typeof proto === "string") {
    for (const part of proto.split(",")) {
      const p = part.trim()
      if (p.startsWith(WS_TOKEN_PREFIX) && p.length > WS_TOKEN_PREFIX.length) return p.slice(WS_TOKEN_PREFIX.length)
    }
  }
  return undefined
}

export function offersSubprotocol(headers: IncomingHttpHeaders): boolean {
  const proto = headers["sec-websocket-protocol"]
  return typeof proto === "string" && proto.split(",").some((p) => p.trim() === WS_SUBPROTOCOL)
}

/**
 * The Host's request guard (invariant 7). The Host header must be the loopback address, and an Origin, if
 * the client sends one (every browser does for a WebSocket and a cross-site request), must be the Host's own.
 * Pages of the UI itself are public, everything under /api and the WebSocket needs the per-launch token.
 * This is what stops another web page from driving the Host through the user's browser.
 */
export function checkHostRequest(
  req: { method?: string; url?: string; headers: IncomingHttpHeaders },
  opts: HostGuardOptions,
): HostGuardResult {
  const host = req.headers.host
  if (typeof host !== "string" || !allowedHosts(opts.port).includes(host.toLowerCase())) {
    return { ok: false, status: 403, error: "forbidden" }
  }
  const origin = req.headers.origin
  if (origin !== undefined && !allowedOrigins(opts.port).includes(origin.toLowerCase())) {
    return { ok: false, status: 403, error: "forbidden" }
  }
  const pathname = (req.url ?? "").split("?")[0] ?? ""
  const protectedPath = pathname === "/ws" || pathname === "/api" || pathname.startsWith("/api/")
  if (protectedPath) {
    const presented = extractToken(req.headers)
    if (presented === undefined || !secretsEqual(presented, opts.token)) {
      return { ok: false, status: 401, error: "unauthorized" }
    }
  }
  return { ok: true }
}
