import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export interface HelperPlace {
  /** The installed Codehouse folder, where the helpers sit next to Codehouse.exe. Undefined from the source folder. */
  installDir: string | undefined
  repoRoot: string
  dataDir: string
  log: (line: string) => void
}

/**
 * One of Codehouse's small Windows programs, or undefined where it cannot be had (not Windows, or no C# compiler for a
 * source checkout). Packaged, it sits next to Codehouse.exe. From the source folder it is built once from its C# file
 * in packaging\ into the data folder, with the compiler that ships with Windows, and again when the source is newer.
 */
export function findWindowsHelper(
  o: HelperPlace & { exe: string; source: string; cscArgs: string[]; what: string },
): string | undefined {
  if (process.platform !== "win32") return undefined
  if (o.installDir) {
    const exe = path.join(o.installDir, o.exe)
    return fs.existsSync(exe) ? exe : undefined
  }
  const source = path.join(o.repoRoot, "packaging", o.source)
  const exe = path.join(o.dataDir, "bin", o.exe)
  try {
    if (fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= fs.statSync(source).mtimeMs) return exe
    const csc = [
      `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
      `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
    ].find((p) => fs.existsSync(p))
    if (!csc) return undefined
    fs.mkdirSync(path.dirname(exe), { recursive: true })
    execFileSync(csc, ["/nologo", "/optimize+", ...o.cscArgs, `/out:${exe}`, source], {
      windowsHide: true,
      stdio: "ignore",
    })
    return exe
  } catch (e) {
    o.log(`${o.what} could not be built (${(e as Error).message})`)
    return undefined
  }
}

/** The C# compiler's arguments for Codehouse-Helper.exe, here and in scripts/package.mjs. */
export const HELPER_CSC_ARGS = [
  "/target:winexe",
  "/r:System.Security.dll",
  "/r:System.Windows.Forms.dll",
  "/r:System.Drawing.dll",
]

/**
 * Codehouse-Helper.exe (packaging/Helper.cs): DPAPI sealing and the Windows file windows, without PowerShell (owner,
 * 4 Nov: "Why do I need powershell at all?").
 */
export function findCodehouseHelper(o: HelperPlace): string | undefined {
  return findWindowsHelper({
    ...o,
    exe: "Codehouse-Helper.exe",
    source: "Helper.cs",
    cscArgs: HELPER_CSC_ARGS,
    what: "the Windows helper",
  })
}
