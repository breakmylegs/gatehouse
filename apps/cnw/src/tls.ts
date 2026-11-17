import net from "node:net"

/**
 * How CNW is reached, from the one setting the owner makes (CNW_HOST in .env), so no tracked file is ever edited:
 *   an IPv4 or IPv6 address (home network or internet)     caddy's own certificate authority ("tls internal")
 *   a home-network name (.home.arpa, .lan, .internal, .local, .localhost, or one word with no dot)   the same
 *   any other name                                          Let's Encrypt
 * CNW_TLS=internal|public overrides the choice; CNW_PORT is the port people browse to when 443 is taken.
 * caddy's certificate authority is kept in the caddy-data volume, so the certificate Codehouse pinned when it paired
 * stays the same across restarts and updates.
 */
export type HostKind = "ip" | "local" | "public"
export type TlsMode = "internal" | "public"

const LOCAL_SUFFIXES = [".home.arpa", ".lan", ".internal", ".local", ".localhost"]

/** The host without IPv6 brackets or a trailing dot, in lower case. */
export const bareHost = (host: string): string => host.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase()

export function hostKind(host: string): HostKind {
  const h = bareHost(host)
  if (net.isIP(h)) return "ip"
  if (!h.includes(".") || LOCAL_SUFFIXES.some((s) => h.endsWith(s))) return "local"
  return "public"
}

export class TlsSettingError extends Error {}

export function tlsMode(host: string, override?: string): TlsMode {
  const o = (override ?? "").trim().toLowerCase()
  if (o === "internal" || o === "public") return o
  if (o) throw new TlsSettingError(`CNW_TLS is "${override}"; it can be internal or public, or left out.`)
  return hostKind(host) === "public" ? "public" : "internal"
}

/** The port, when it is one other than 443; undefined for 443 or none. */
export function customPort(port?: string): number | undefined {
  const p = (port ?? "").trim()
  if (!p || p === "443") return undefined
  const n = Number(p)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new TlsSettingError(`CNW_PORT is "${port}"; it must be a port number.`)
  return n
}

/** The host as it goes in a web address: an IPv6 address in brackets. */
export const urlHost = (host: string): string => {
  const h = bareHost(host)
  return net.isIPv6(h) ? `[${h}]` : h
}

/** The address people browse to, such as https://192.168.1.225:8443. */
export function publicUrlOf(host: string, port?: string): string {
  const p = customPort(port)
  return `https://${urlHost(host)}${p ? `:${p}` : ""}`
}

/** CNW_HOST checked: a name or an address, nothing that could change the Caddyfile around it. */
export function checkHost(host: string | undefined): string {
  const h = bareHost(host ?? "")
  if (!h) throw new TlsSettingError("Set CNW_HOST in .env to the name or address people browse to, such as cnw.home.arpa or 192.168.1.225.")
  if (!net.isIP(h) && !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(h))
    throw new TlsSettingError(`CNW_HOST is "${host}", which is not a name or an IP address.`)
  return h
}

/**
 * caddy's configuration for this host. caddy listens on 443 inside its container whatever port is published. For an
 * IP address, default_sni is the address: browsers send no server name for an IP, and inside Docker caddy would
 * otherwise look for a certificate for its own container address and the handshake would fail.
 */
export function caddyfile(o: { host: string; tls?: string; port?: string }): string {
  const host = checkHost(o.host)
  const mode = tlsMode(host, o.tls)
  const port = customPort(o.port)
  const global = [
    ...(net.isIP(host) ? [`\tdefault_sni ${host}`] : []),
    // On another port, caddy's redirect from http would send people to 443, where nothing answers.
    ...(port ? ["\tauto_https disable_redirects"] : []),
  ]
  return [
    "# Written by cnw-config from CNW_HOST, CNW_TLS and CNW_PORT in .env. Do not edit: it is written again at each start.",
    ...(global.length ? ["{", ...global, "}", ""] : []),
    `${urlHost(host)} {`,
    ...(mode === "internal" ? ["\ttls internal"] : []),
    "\tencode zstd gzip",
    "\theader {",
    '\t\tStrict-Transport-Security "max-age=31536000"',
    "\t\tX-Content-Type-Options nosniff",
    "\t\tReferrer-Policy no-referrer",
    "\t\tX-Frame-Options DENY",
    "\t\t-Server",
    "\t}",
    "\treverse_proxy 172.30.0.20:8080 {",
    "\t\theader_up X-Forwarded-For {remote_host}",
    "\t}",
    "}",
    "",
  ].join("\n")
}
