import net from "node:net"

/**
 * The IP allow list (owner, 15 Nov): address ranges whose requests need no sign-in. Off and empty until set. The
 * address is the one the connection came from as caddy passed it on the private network (never a header from
 * outside). Ranges that would cover every address (0.0.0.0/0, ::/0, or anything wider than /8 for IPv4 and /16 for
 * IPv6) are refused, so a typo cannot open CNW to the internet.
 */
export interface Range {
  base: string
  bits: number
  v6: boolean
}

const toBig = (ip: string): bigint | undefined => {
  if (net.isIPv4(ip)) return ip.split(".").reduce((n, o) => (n << 8n) + BigInt(Number(o)), 0n)
  if (!net.isIPv6(ip)) return undefined
  const [head, tail] = ip.split("::")
  const part = (s?: string) => (s ? s.split(":") : [])
  const h = part(head)
  const t = part(tail)
  const fill = ip.includes("::") ? Array(8 - h.length - t.length).fill("0") : []
  const groups = [...h, ...fill, ...t]
  if (groups.length !== 8) return undefined
  return groups.reduce((n, g) => (n << 16n) + BigInt(parseInt(g || "0", 16)), 0n)
}

/** A range from "192.168.1.0/24" or a single address, or why it is refused. */
export function parseRange(text: string): Range | string {
  const [ip, b] = text.trim().split("/")
  if (!ip) return "Give an address or a range such as 192.168.1.0/24."
  const v6 = net.isIPv6(ip)
  if (!v6 && !net.isIPv4(ip)) return `${ip} is not an IP address.`
  const max = v6 ? 128 : 32
  const bits = b === undefined ? max : Number(b)
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return `/${b} is not a range size for that address.`
  if (bits < (v6 ? 16 : 8)) return "That range would cover far too many addresses, so it is refused."
  return { base: ip, bits, v6 }
}

/** Strips the IPv4-mapped IPv6 prefix Node gives some IPv4 connections. */
export const plainIp = (ip: string): string => (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip)

export function inRange(ip: string, r: Range): boolean {
  const addr = plainIp(ip)
  if (net.isIPv6(addr) !== r.v6) return false
  const a = toBig(addr)
  const b = toBig(r.base)
  if (a === undefined || b === undefined) return false
  const width = r.v6 ? 128n : 32n
  const shift = width - BigInt(r.bits)
  return a >> shift === b >> shift
}

export const allowed = (ip: string, ranges: readonly Range[]): boolean => ranges.some((r) => inRange(ip, r))
