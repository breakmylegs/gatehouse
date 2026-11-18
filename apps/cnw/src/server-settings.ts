import { caddyfile, checkHost, customPort, tlsMode, TlsSettingError } from "./tls.js"

/**
 * Uplift phase 2 (owner, 17 Nov): CNW's own settings are set on its Server page and kept in its data volume
 * (server.json); `.env` is the start only. A value saved here wins over the same one in `.env`. cnw-config reads this
 * file at each start and whenever a change is applied, so caddy's configuration follows it.
 */
export interface ServerSettings {
  /** The name or address people browse to (CNW_HOST). */
  host?: string
  /** internal or public; empty for the choice made from the address. */
  tls?: string
  /** The port people browse to, when 443 is taken (CNW_PORT). */
  port?: string
  /** Proxies whose X-Forwarded-For is believed, a comma list (CNW_TRUSTED_PROXY). */
  trustedProxy?: string
  /** When and by whom they were last saved. */
  savedAt?: string
  savedBy?: string
}

export interface Effective {
  host: string
  tls: string
  port: string
  trustedProxy: string
}

/** What applies: each saved value, else the one from the environment. */
export function effective(env: Record<string, string | undefined>, saved: ServerSettings): Effective {
  return {
    host: saved.host ?? env.CNW_HOST ?? "",
    tls: saved.tls ?? env.CNW_TLS ?? "",
    port: saved.port ?? env.CNW_PORT ?? "",
    trustedProxy: saved.trustedProxy ?? env.CNW_TRUSTED_PROXY ?? "",
  }
}

const proxyList = /^[0-9a-fA-F:.,\s]{0,400}$/

/** Checks what was typed; caddy's configuration is made from it, so nothing reaches caddy that it would not take. */
export function checkSettings(input: unknown): { settings: Required<Pick<ServerSettings, "host" | "tls" | "port" | "trustedProxy">> } | { error: string } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const text = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "")
  try {
    const host = checkHost(text("host"))
    const tls = text("tls").toLowerCase()
    tlsMode(host, tls)
    const port = text("port")
    customPort(port)
    const trustedProxy = text("trustedProxy")
    if (!proxyList.test(trustedProxy)) return { error: "Trusted proxies are IP addresses, separated by commas." }
    // Made once to be sure caddy would take it.
    caddyfile({ host, tls, port })
    return { settings: { host, tls, port, trustedProxy } }
  } catch (e) {
    if (e instanceof TlsSettingError)
      return { error: e.message.replace(/^CNW_HOST is/, "The address is").replace(/^CNW_TLS is/, "The certificate choice is").replace(/^CNW_PORT is/, "The port is").replace(/in \.env /, "") }
    throw e
  }
}

/**
 * Whether a change gives CNW a new certificate, which every paired computer refuses (it pinned the old one) until it
 * is paired again: another address, or the other kind of certificate. A port or a trusted proxy keeps it.
 */
export function newCertificate(from: Effective, to: Pick<Effective, "host" | "tls">): boolean {
  if (checkHost(from.host) !== checkHost(to.host)) return true
  return tlsMode(from.host, from.tls) !== tlsMode(to.host, to.tls)
}

/** A SHA-256 fingerprint in groups of four, as the Server page shows it beside Codehouse's pin. */
export const grouped = (hex: string): string => (hex.toLowerCase().match(/.{1,4}/g) ?? []).join(" ")
