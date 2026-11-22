/**
 * E-029, port and process tracking (Expansion E3). What each session started and left running: the processes under
 * its Claude Code process (from the job's root, as T-113 finds its ports), how long each has run, and the ports it
 * listens on. A command that would start a server on a port something already listens on goes to a person first
 * (port-clash), before it runs. A process is stopped only when you confirm it, and only while it is still under that
 * session; Claude Code's own processes are never offered. One fixed PowerShell query; no input of anyone's reaches it.
 */
import { execFile } from "node:child_process"

export const PORT_CLASH_RULE = "port-clash"

export interface ProcRow {
  pid: number
  parent: number
  name: string
  /** When it started, as an ISO time, when Windows says. */
  started?: string
}
export interface ListenRow {
  port: number
  pid: number
}

export interface SessionProcess {
  pid: number
  name: string
  started?: string
  ports: number[]
}

/** Claude Code's and Codehouse's own processes, which are never offered to stop. */
const OWN = /^(claude(\.exe)?|codehouse-limits(\.exe)?|conhost(\.exe)?)$/i

/** The processes below a session's root, with their listening ports; its own processes left out. */
export function processesUnder(root: number, procs: ProcRow[], listening: ListenRow[]): SessionProcess[] {
  const children = new Map<number, ProcRow[]>()
  for (const p of procs) children.set(p.parent, [...(children.get(p.parent) ?? []), p])
  const out: SessionProcess[] = []
  const queue = [root]
  const seen = new Set([root])
  while (queue.length)
    for (const c of children.get(queue.shift()!) ?? []) {
      if (seen.has(c.pid)) continue
      seen.add(c.pid)
      queue.push(c.pid)
      if (OWN.test(c.name)) continue
      out.push({ pid: c.pid, name: c.name, ...(c.started ? { started: c.started } : {}), ports: listening.filter((l) => l.pid === c.pid).map((l) => l.port).sort((a, b) => a - b) })
    }
  return out
}

/** The port a command would start a server on: --port N, -p N, PORT=N, or the usual port of a known dev server. */
export function serverPort(command: string): number | undefined {
  const explicit = /(?:--port[= ]|\s-p\s|\bPORT=|\$env:PORT\s*=\s*['"]?)(\d{2,5})\b/i.exec(command)
  if (explicit) return Number(explicit[1])
  const known: Array<[RegExp, number]> = [
    [/\bvite(\s|$)|npm run dev\b.*vite/i, 5173],
    [/\bnext dev\b/i, 3000],
    [/\bnuxt dev\b/i, 3000],
    [/\breact-scripts start\b/i, 3000],
    [/\bng serve\b/i, 4200],
    [/\bpython3? -m http\.server\b/i, 8000],
    [/\bdjango-admin runserver\b|\bmanage\.py runserver\b/i, 8000],
    [/\bflask run\b/i, 5000],
    [/\bdotnet (watch )?run\b/i, 5000],
  ]
  return known.find(([re]) => re.test(command))?.[1]
}

export const portClashReason = (port: number, holder: string) =>
  `This looks like it starts a server on port ${port}, and ${holder} already listens on it, so it would clash. Stop that first, or choose another port.`

const QUERY = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$p = Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; name = [string]$_.Name; started = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null } } }",
  "$l = Get-NetTCPConnection -State Listen | ForEach-Object { [pscustomobject]@{ port = [int]$_.LocalPort; pid = [int]$_.OwningProcess } }",
  "[pscustomobject]@{ procs = @($p); listening = @($l) } | ConvertTo-Json -Depth 3 -Compress",
].join("; ")

export type Snapshot = () => Promise<{ procs: ProcRow[]; listening: ListenRow[] }>

export const windowsSnapshot: Snapshot = () =>
  new Promise((resolve, reject) =>
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", QUERY], { windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }, (e, out) => {
      if (e) return reject(e)
      try {
        const v = JSON.parse(String(out)) as { procs?: ProcRow[]; listening?: ListenRow[] }
        resolve({ procs: v.procs ?? [], listening: v.listening ?? [] })
      } catch (err) {
        reject(err as Error)
      }
    }),
  )

/** Who listens on a port now, as "node.exe (1234)", or undefined when nothing does. */
export async function portHolder(port: number, snap: Snapshot): Promise<string | undefined> {
  const { procs, listening } = await snap()
  const hit = listening.find((l) => l.port === port)
  if (!hit) return undefined
  return `${procs.find((p) => p.pid === hit.pid)?.name ?? "a process"} (${hit.pid})`
}

/** Stops one process and what it started, only when it is still under the session and you confirmed. */
export async function stopUnder(root: number, pid: number, confirmed: boolean, snap: Snapshot, kill: (pid: number) => Promise<void>): Promise<{ stopped: boolean; why?: string }> {
  if (!confirmed) return { stopped: false, why: "Stopping a process needs your confirmation." }
  const { procs, listening } = await snap()
  if (!processesUnder(root, procs, listening).some((p) => p.pid === pid)) return { stopped: false, why: "That process is not one this session started, or it has already ended." }
  await kill(pid)
  return { stopped: true }
}

export const taskkill = (pid: number): Promise<void> =>
  new Promise((resolve, reject) =>
    execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 15_000 }, (e) => (e ? reject(e) : resolve())),
  )
