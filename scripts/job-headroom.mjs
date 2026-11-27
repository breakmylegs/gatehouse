// O60 (owner, 27 Nov): how much memory this run has. A Codehouse session runs everything inside its Windows job object
// (Codehouse-Limits.exe), whose cap covers the whole tree: a release's npm, tsx, the test runner and each test process
// all count against it. At Low (2 GB) a release crashed halfway (V8 "Fatal process out of memory: Zone"). This finds the
// job this process is in (the nearest Codehouse-Limits.exe above it), reads its cap from the job itself (a level raised
// since it started is not on the helper's command line), and adds up what the tree uses now. It only reads; it never
// changes or leaves the job. Outside a Codehouse session, or not on Windows: no job, nothing to check.
import { execFileSync } from "node:child_process"

/** The levels and their memory, as apps/host/src/limits.ts has them, smallest first. */
export const LEVEL_MB = [
  ["lowest", 1024],
  ["low", 2048],
  ["medium", 4096],
  ["higher", 8192],
  ["high", 0],
]
export const LEVEL_NAME = { lowest: "Lowest", low: "Low", medium: "Medium", higher: "Higher", high: "High (no cap)" }

/** The level a cap is (0: High, no cap). */
export const levelOf = (mb) => (LEVEL_MB.find(([, m]) => m === mb) ?? ["custom", mb])[0]

/** The smallest level whose cap leaves `needMb` free beside what is used now outside this run. */
export function levelFor(needMb, usedMb) {
  for (const [name, mb] of LEVEL_MB) if (mb === 0 || mb - usedMb >= needMb) return name
  return "high"
}

const PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class CodehJob {
  [StructLayout(LayoutKind.Sequential)] public struct BASIC { public long a, b; public uint LimitFlags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
  [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] public struct EXT { public BASIC Basic; public IO Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool QueryInformationJobObject(IntPtr job, int cls, out EXT info, int len, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool QueryInformationJobObject(IntPtr job, int cls, IntPtr info, int len, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool IsProcessInJob(IntPtr proc, IntPtr job, out bool result);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  // The processes in a job (JobObjectBasicProcessIdList), up to 4096.
  public static uint[] Pids(IntPtr job) {
    int n = 4096; int size = 8 + n * IntPtr.Size; IntPtr buf = Marshal.AllocHGlobal(size);
    try {
      if (!QueryInformationJobObject(job, 3, buf, size, IntPtr.Zero)) return new uint[0];
      int count = Marshal.ReadInt32(buf, 4); uint[] r = new uint[count];
      for (int i = 0; i < count; i++) r[i] = (uint)Marshal.ReadIntPtr(buf, 8 + i * IntPtr.Size).ToInt64();
      return r;
    } finally { Marshal.FreeHGlobal(buf); }
  }
}
'@
$target = [CodehJob]::OpenProcess(0x1000, $false, [uint32]$args[0])
if ($target -eq [IntPtr]::Zero) { '{"inJob":false}'; exit 0 }
$found = $null
foreach ($l in Get-CimInstance Win32_Process -Filter "Name='Codehouse-Limits.exe'") {
  $name = ([regex]'--name\s+(\S+)').Match($l.CommandLine).Groups[1].Value
  if (-not $name) { continue }
  # JOB_OBJECT_QUERY: read only.
  $h = [CodehJob]::OpenJobObject(4, $false, $name)
  if ($h -eq [IntPtr]::Zero) { continue }
  $in = $false
  if ([CodehJob]::IsProcessInJob($target, $h, [ref]$in) -and $in) { $found = @{ name = $name; handle = $h; helper = $l }; break }
  [void][CodehJob]::CloseHandle($h)
}
[void][CodehJob]::CloseHandle($target)
if (-not $found) { '{"inJob":false}'; exit 0 }
$e = New-Object CodehJob+EXT
$limitMb = $null; $peakMb = $null
if ([CodehJob]::QueryInformationJobObject($found.handle, 9, [ref]$e, [Runtime.InteropServices.Marshal]::SizeOf($e), [IntPtr]::Zero)) {
  # JOB_OBJECT_LIMIT_JOB_MEMORY: a cap on the whole job; without it, none.
  $limitMb = if (($e.Basic.LimitFlags -band 0x200) -ne 0) { [math]::Floor([double]$e.JobMemoryLimit.ToUInt64() / 1MB) } else { 0 }
  $peakMb = [math]::Floor([double]$e.PeakJobMemoryUsed.ToUInt64() / 1MB)
}
$pids = [CodehJob]::Pids($found.handle)
[void][CodehJob]::CloseHandle($found.handle)
if ($null -eq $limitMb) { $limitMb = [int](([regex]'--memory-mb\s+(\d+)').Match($found.helper.CommandLine).Groups[1].Value) }
$used = [long]0
if ($pids.Count) {
  $set = @{}; foreach ($p in $pids) { $set[[int]$p] = $true }
  foreach ($q in Get-CimInstance Win32_Process) { if ($set[[int]$q.ProcessId]) { $used += [long]$q.PrivatePageCount } }
}
@{ inJob = $true; job = $found.name; limitMb = $limitMb; usedMb = [math]::Floor($used / 1MB); peakMb = $peakMb; processes = $pids.Count } | ConvertTo-Json -Compress
`

/** This process's job: its cap (0: none) and what its tree uses now, in MB. Undefined when not in a Codehouse job. */
export function jobHeadroom(pid = process.pid, run = execFileSync) {
  if (process.platform !== "win32") return undefined
  let out
  try {
    out = run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", PS, String(pid)], { encoding: "utf8", windowsHide: true, timeout: 60_000 })
  } catch {
    try {
      out = run("powershell", ["-NoProfile", "-NonInteractive", "-Command", PS, String(pid)], { encoding: "utf8", windowsHide: true, timeout: 60_000 })
    } catch {
      return undefined
    }
  }
  const j = JSON.parse(String(out).trim().split(/\r?\n/).pop())
  if (!j.inJob) return undefined
  return { job: j.job, limitMb: Number(j.limitMb), usedMb: Number(j.usedMb), ...(j.peakMb != null ? { peakMb: Number(j.peakMb) } : {}) }
}

/**
 * Whether a run needing `needMb` fits here. Not in a job, or a job without a cap: it fits. Otherwise the message names
 * the level it needs (the smallest that leaves that much beside what the tree uses now).
 */
export function fits(needMb, h) {
  if (!h || h.limitMb === 0) return { ok: true }
  const free = h.limitMb - h.usedMb
  if (free >= needMb) return { ok: true, free }
  const now = levelOf(h.limitMb)
  const need = levelFor(needMb, h.usedMb)
  return {
    ok: false,
    free,
    message: `This session runs at ${LEVEL_NAME[now] ?? `${h.limitMb} MB`} (${h.limitMb} MB for everything it runs, ${h.usedMb} MB in use), and this needs about ${needMb} MB free, so it would run out of memory partway. Raise the session to ${LEVEL_NAME[need]} for it: the session can ask with the Companion tool raise_resources, which asks you on an approval card, or choose the level on the session's Details.`,
  }
}
