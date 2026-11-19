import { execFile } from "node:child_process"

/**
 * T-113: the ports a session's processes are listening on (a dev server, a preview), so its browser panel can open
 * them. From the process Codehouse started the session in down through everything it started, on Windows with one
 * fixed PowerShell query (no input of anyone's reaches it). Read only.
 */
export interface Listening {
  port: number
  pid: number
  process: string
  address: string
}

export interface ProcRow {
  pid: number
  parent: number
  name: string
}
export interface SocketRow {
  port: number
  pid: number
  address: string
}

/** The sockets held by `root` or anything below it, one a port, lowest first. */
export function portsUnder(root: number, procs: ProcRow[], sockets: SocketRow[]): Listening[] {
  const children = new Map<number, number[]>()
  for (const p of procs) children.set(p.parent, [...(children.get(p.parent) ?? []), p.pid])
  const mine = new Set<number>([root])
  const queue = [root]
  while (queue.length)
    for (const c of children.get(queue.shift()!) ?? [])
      if (!mine.has(c)) {
        mine.add(c)
        queue.push(c)
      }
  const names = new Map(procs.map((p) => [p.pid, p.name]))
  const by = new Map<number, Listening>()
  for (const s of sockets)
    if (mine.has(s.pid) && s.port > 0 && s.port < 65536 && !by.has(s.port)) by.set(s.port, { port: s.port, pid: s.pid, process: names.get(s.pid) ?? "", address: s.address })
  return [...by.values()].sort((a, b) => a.port - b.port)
}

const QUERY = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$p = Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; name = [string]$_.Name } }",
  "$s = Get-NetTCPConnection -State Listen | ForEach-Object { [pscustomobject]@{ port = [int]$_.LocalPort; pid = [int]$_.OwningProcess; address = [string]$_.LocalAddress } }",
  "[pscustomobject]@{ procs = @($p); sockets = @($s) } | ConvertTo-Json -Depth 3 -Compress",
].join("; ")

/** What is listening under a session's root process, on Windows; none elsewhere or when it cannot be read. */
export function sessionPorts(root: number | undefined, platform = process.platform): Promise<Listening[]> {
  if (root === undefined || platform !== "win32") return Promise.resolve([])
  return new Promise((resolve) =>
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", QUERY], { windowsHide: true, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (e, out) => {
      if (e) return resolve([])
      try {
        const v = JSON.parse(String(out)) as { procs?: ProcRow[]; sockets?: SocketRow[] }
        resolve(portsUnder(root, v.procs ?? [], v.sockets ?? []))
      } catch {
        resolve([])
      }
    }),
  )
}
