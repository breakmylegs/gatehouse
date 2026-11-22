/**
 * E-027, Dev Drive and Defender awareness (Expansion E3). Doctor shows the volume each project is on: a Dev Drive (a
 * ReFS volume Windows trusts for development, where Defender scans in performance mode), another ReFS volume, or
 * NTFS; and Defender's performance mode for Dev Drives, where a standard user can read it, else "not known". One
 * fixed PowerShell query with no input of anyone's in it, that never asks to run as administrator: what needs that is
 * simply reported as not known. On a Mac this is not shown.
 */
import { execFile } from "node:child_process"
import path from "node:path"
import type { DoctorCheck } from "./doctor.js"

export interface VolumeFacts {
  drive: string
  fileSystem: string
  /** True on a Dev Drive, false when Windows says it is not one, undefined when it could not say. */
  devDrive?: boolean
}

export interface DevDriveFacts {
  volumes: VolumeFacts[]
  /** Defender's performance mode for Dev Drives: on, off, or not known. */
  defenderPerformance: "on" | "off" | "not known"
}

/** The query: each drive's file system, whether it is a Dev Drive, and Defender's setting; nothing elevated. */
export function devDriveQuery(drives: string[]): string {
  const list = drives.map((d) => `'${d.replace(/[^A-Za-z:]/g, "")}'`).join(",")
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    `$v = @(${list}) | ForEach-Object { $d = $_; $fs = (Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$d'").FileSystem; $q = (fsutil devdrv query $d 2>&1 | Out-String); $dev = if ($q -match 'is a (trusted )?developer volume') { 'yes' } elseif ($q -match 'not a developer volume') { 'no' } else { 'unknown' }; [pscustomobject]@{ drive = $d; fileSystem = [string]$fs; devDrive = $dev } }`,
    "$p = 'not known'; try { $s = (Get-MpPreference).PerformanceModeStatus; if ($s -eq 1) { $p = 'on' } elseif ($s -eq 0) { $p = 'off' } } catch {}",
    "[pscustomobject]@{ volumes = @($v); defenderPerformance = $p } | ConvertTo-Json -Depth 3 -Compress",
  ].join("; ")
}

/** The drive letters of project folders, each once. */
export function drivesOf(folders: string[]): string[] {
  return [...new Set(folders.map((f) => /^([A-Za-z]:)/.exec(path.resolve(f))?.[1]?.toUpperCase()).filter((d): d is string => Boolean(d)))]
}

export function readDevDrive(folders: string[], platform: NodeJS.Platform = process.platform): Promise<DevDriveFacts | undefined> {
  const drives = drivesOf(folders)
  if (platform !== "win32" || !drives.length) return Promise.resolve(undefined)
  return new Promise((resolve) =>
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", devDriveQuery(drives)], { windowsHide: true, timeout: 20_000 }, (e, out) => {
      if (e) return resolve(undefined)
      try {
        const v = JSON.parse(String(out)) as { volumes?: Array<{ drive: string; fileSystem: string; devDrive: string }>; defenderPerformance?: string }
        resolve({
          volumes: (v.volumes ?? []).map((x) => ({ drive: x.drive, fileSystem: x.fileSystem || "not known", ...(x.devDrive === "yes" ? { devDrive: true } : x.devDrive === "no" ? { devDrive: false } : {}) })),
          defenderPerformance: v.defenderPerformance === "on" || v.defenderPerformance === "off" ? v.defenderPerformance : "not known",
        })
      } catch {
        resolve(undefined)
      }
    }),
  )
}

const kindOf = (v: VolumeFacts) => (v.devDrive ? "Dev Drive" : v.fileSystem === "ReFS" ? (v.devDrive === false ? "ReFS" : "ReFS (Dev Drive not known)") : v.fileSystem)

export function devDriveCheck(facts: DevDriveFacts | undefined, projects: Array<{ name: string; folder: string }>): DoctorCheck {
  if (!facts) return { id: "dev-drive", label: "Project volumes", state: "ok", detail: "Not known on this computer." }
  const by = new Map(facts.volumes.map((v) => [v.drive.toUpperCase(), v]))
  const each = projects.map((p) => {
    const d = drivesOf([p.folder])[0]
    const v = d ? by.get(d) : undefined
    return `${p.name} on ${d ?? "?"} (${v ? kindOf(v) : "not known"})`
  })
  const onDev = facts.volumes.some((v) => v.devDrive)
  const detail = `${each.join(", ") || "No projects yet"}. Defender's performance mode for Dev Drives: ${facts.defenderPerformance}.`
  return !onDev && projects.length
    ? { id: "dev-drive", label: "Project volumes", state: "ok", detail, fix: "Builds and installs are faster on a Dev Drive, where Defender scans in performance mode. Settings, System, Storage, Disks and volumes, Create a Dev Drive (it needs an administrator once)." }
    : { id: "dev-drive", label: "Project volumes", state: "ok", detail }
}
