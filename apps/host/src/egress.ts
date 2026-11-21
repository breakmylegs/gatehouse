/**
 * D-094, a verifiable egress report (Frontier build), the safe variant. Every minute, one fixed PowerShell query lists
 * the computer's processes and its TCP connections (Get-NetTCPConnection, the same table GetExtendedTcpTable reads;
 * no administrator rights) and its UDP endpoints; each session gets the remote endpoints its own processes (its Claude
 * Code process and everything below it) reached. Each is checked against what that session may reach: this computer
 * always; for a Claude session, Anthropic's API (its published ranges, and the addresses its hosts resolve to now) and
 * any hosts you add in Settings; for a session on a model on this computer, nothing else. The report is signed with
 * this computer's key. An endpoint outside the list is flagged; in strict mode it also stops the session (fail closed).
 * ETW capture, which needs administrator rights, is listed for IT, not built. The plan named a C# helper
 * (packaging/Egress.cs); PowerShell's cmdlets read the same tables, so no new program had to be packaged.
 */
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import dns from "node:dns/promises"
import net from "node:net"

export interface ProcRow {
  pid: number
  parent: number
  name: string
}
export interface ConnRow {
  pid: number
  remote: string
  port: number
  proto: "tcp" | "udp"
}

export interface Endpoint {
  remote: string
  port: number
  proto: "tcp" | "udp"
  process: string
  firstSeen: string
  lastSeen: string
  allowed: boolean
  /** What allowed it: this computer, Anthropic, or a host you added. */
  why?: string
}

/** Anthropic's published API address ranges. */
export const ANTHROPIC_RANGES = ["160.79.104.0/23", "2607:6bc0::/48"]
export const ANTHROPIC_HOSTS = ["api.anthropic.com", "statsig.anthropic.com", "console.anthropic.com", "claude.ai", "mcp-proxy.anthropic.com"]

/** The processes at and below `root`. */
export function descendants(root: number, procs: ProcRow[]): Set<number> {
  const children = new Map<number, number[]>()
  for (const p of procs) children.set(p.parent, [...(children.get(p.parent) ?? []), p.pid])
  const mine = new Set([root])
  const queue = [root]
  while (queue.length)
    for (const c of children.get(queue.shift()!) ?? [])
      if (!mine.has(c)) {
        mine.add(c)
        queue.push(c)
      }
  return mine
}

const isLoopback = (a: string) => a === "::1" || a.startsWith("127.") || a === "0.0.0.0" || a === "::" || a.startsWith("::ffff:127.")

/** Whether an address is in a CIDR range (IPv4 or IPv6). */
export function inRange(addr: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/")
  const bits = Number(bitsText)
  const list = new net.BlockList()
  const type = net.isIPv6(base!) ? "ipv6" : "ipv4"
  if (net.isIP(addr) === 0 || (net.isIPv6(addr) ? "ipv6" : "ipv4") !== type) return false
  list.addSubnet(base!, bits, type)
  return list.check(addr, type)
}

export interface AllowList {
  local: boolean
  /** Addresses Anthropic's and your hosts resolve to now. */
  resolved: Map<string, string>
}

/** Whether a session may reach an address, and why. */
export function classify(remote: string, allow: AllowList): { allowed: boolean; why?: string } {
  if (isLoopback(remote)) return { allowed: true, why: "this computer" }
  if (allow.local) return { allowed: false }
  if (ANTHROPIC_RANGES.some((r) => inRange(remote, r))) return { allowed: true, why: "Anthropic" }
  const host = allow.resolved.get(remote)
  return host ? { allowed: true, why: host } : { allowed: false }
}

/** The addresses the allowed hosts resolve to now, each mapped to its host. */
export async function resolveHosts(hosts: string[], lookup: (h: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((x) => x.address)): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  await Promise.all(
    hosts.map(async (h) => {
      for (const a of await lookup(h).catch(() => [] as string[])) out.set(a, h)
    }),
  )
  return out
}

const QUERY = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$p = Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; name = [string]$_.Name } }",
  "$t = Get-NetTCPConnection -State Established,SynSent | ForEach-Object { [pscustomobject]@{ pid = [int]$_.OwningProcess; remote = [string]$_.RemoteAddress; port = [int]$_.RemotePort; proto = 'tcp' } }",
  "$u = Get-NetUDPEndpoint | ForEach-Object { [pscustomobject]@{ pid = [int]$_.OwningProcess; remote = [string]$_.LocalAddress; port = [int]$_.LocalPort; proto = 'udp' } }",
  "[pscustomobject]@{ procs = @($p); conns = @($t) + @($u) } | ConvertTo-Json -Depth 3 -Compress",
].join("; ")

export type Sampler = () => Promise<{ procs: ProcRow[]; conns: ConnRow[] }>

export const windowsSampler: Sampler = () =>
  new Promise((resolve, reject) =>
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", QUERY], { windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }, (e, out) => {
      if (e) return reject(e)
      try {
        const v = JSON.parse(String(out)) as { procs?: ProcRow[]; conns?: ConnRow[] }
        resolve({ procs: v.procs ?? [], conns: v.conns ?? [] })
      } catch (err) {
        reject(err as Error)
      }
    }),
  )

export interface WatchedSession {
  id: string
  rootPid: number | undefined
  local: boolean
}

export interface EgressReport {
  v: 1
  session: string
  from: string
  to: string
  endpoints: Endpoint[]
  flagged: number
}

/** What each session reached, sampled; signed reports; strict mode stops a session that reached outside its list. */
export class EgressMonitor {
  readonly #seen = new Map<string, { from: string; endpoints: Map<string, Endpoint> }>()

  constructor(
    private readonly o: {
      sessions: () => WatchedSession[]
      sampler: Sampler
      extraHosts: () => string[]
      strict: () => boolean
      onFlagged: (session: string, e: Endpoint, stop: boolean) => void
      lookup?: (h: string) => Promise<string[]>
      now?: () => Date
    },
  ) {}

  async sample(): Promise<void> {
    const sessions = this.o.sessions().filter((s) => s.rootPid !== undefined)
    if (!sessions.length) return
    const { procs, conns } = await this.o.sampler()
    const resolved = await resolveHosts([...ANTHROPIC_HOSTS, ...this.o.extraHosts()], this.o.lookup)
    const names = new Map(procs.map((p) => [p.pid, p.name]))
    const at = (this.o.now ?? (() => new Date()))().toISOString()
    for (const s of sessions) {
      const mine = descendants(s.rootPid!, procs)
      const kept = this.#seen.get(s.id) ?? { from: at, endpoints: new Map<string, Endpoint>() }
      this.#seen.set(s.id, kept)
      for (const c of conns) {
        if (!mine.has(c.pid) || (c.proto === "udp" && isLoopback(c.remote))) continue
        const key = `${c.proto}:${c.remote}:${c.port}`
        const was = kept.endpoints.get(key)
        if (was) {
          was.lastSeen = at
          continue
        }
        const verdict = c.proto === "udp" ? { allowed: true, why: "a local UDP endpoint (no remote address)" } : classify(c.remote, { local: s.local, resolved })
        const e: Endpoint = { remote: c.remote, port: c.port, proto: c.proto, process: names.get(c.pid) ?? "", firstSeen: at, lastSeen: at, ...verdict }
        kept.endpoints.set(key, e)
        if (!e.allowed) this.o.onFlagged(s.id, e, this.o.strict())
      }
    }
  }

  report(session: string): EgressReport | undefined {
    const kept = this.#seen.get(session)
    if (!kept) return undefined
    const endpoints = [...kept.endpoints.values()].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen))
    return { v: 1, session, from: kept.from, to: (this.o.now ?? (() => new Date()))().toISOString(), endpoints, flagged: endpoints.filter((e) => !e.allowed).length }
  }

  forget(session: string): void {
    this.#seen.delete(session)
  }
}

/** A report signed with this computer's key, so it can be checked later. */
export async function signReport(r: EgressReport, sign: (bytes: Buffer) => Promise<{ signature: string; publicKey: string }>): Promise<{ report: string; signature: string; publicKey: string }> {
  const bytes = Buffer.from(JSON.stringify(r), "utf8")
  return { report: bytes.toString("base64"), ...(await sign(bytes)) }
}

/** Whether a signed report checks against its key. */
export function verifyReport(s: { report: string; signature: string; publicKey: string }): boolean {
  try {
    return crypto.verify(null, Buffer.from(s.report, "base64"), crypto.createPublicKey(s.publicKey), Buffer.from(s.signature, "base64"))
  } catch {
    return false
  }
}
