import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inlineScriptArgs, powerShellExe } from "@gatehouse/policy"

/** Keeps secrets off the disk in the clear. On Windows this is DPAPI for the current user. */
export interface Protector {
  protect(bytes: Uint8Array): Promise<Uint8Array>
  unprotect(bytes: Uint8Array): Promise<Uint8Array>
}

/**
 * scripts/dpapi.ps1, found by going up from this file to the app folder. Counting folders would break when the Host
 * is built into one file (apps/host/dist/main.mjs sits one level higher than this file does in the sources).
 */
function findScript(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, "scripts", "dpapi.ps1")
    if (fs.existsSync(p)) return p
    dir = path.dirname(dir)
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../scripts/dpapi.ps1")
}
const DEFAULT_SCRIPT = findScript()

/**
 * DPAPI through Codehouse-Helper.exe (packaging/Helper.cs), with no PowerShell at all (owner, 4 Nov: "Why do I need
 * powershell at all?"). It is the same Windows call as DpapiProtector, so each opens what the other sealed.
 */
export class HelperProtector implements Protector {
  constructor(private readonly exe: string) {}

  #run(mode: "protect" | "unprotect", bytes: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.exe,
        [`--${mode}`],
        { timeout: 30_000, maxBuffer: 1 << 20, windowsHide: true },
        (err, stdout) => {
          if (err) return reject(new Error(`DPAPI ${mode} failed: ${err.message.split("\n")[0]}`))
          resolve(new Uint8Array(Buffer.from(stdout.trim(), "base64")))
        },
      )
      child.stdin?.on("error", () => undefined)
      child.stdin?.end(Buffer.from(bytes).toString("base64"))
    })
  }

  protect(bytes: Uint8Array) {
    return this.#run("protect", bytes)
  }
  unprotect(bytes: Uint8Array) {
    return this.#run("unprotect", bytes)
  }
}

/**
 * The fallback where the helper cannot be had (a source checkout with no C# compiler): DPAPI through PowerShell 7 if
 * it is installed, otherwise the Windows PowerShell every Windows has (owner, 4 Nov).
 */
export class DpapiProtector implements Protector {
  constructor(
    private readonly script = DEFAULT_SCRIPT,
    private readonly pwsh = powerShellExe(),
  ) {}

  #run(mode: "protect" | "unprotect", bytes: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      let args: string[]
      try {
        args = inlineScriptArgs(this.script, [mode])
      } catch (e) {
        reject(new Error(`DPAPI ${mode} failed: ${(e as Error).message}`))
        return
      }
      const child = execFile(
        this.pwsh,
        args,
        { timeout: 30_000, maxBuffer: 1 << 20, windowsHide: true },
        (err, stdout) => {
          if (err) return reject(new Error(`DPAPI ${mode} failed: ${err.message.split("\n")[0]}`))
          resolve(new Uint8Array(Buffer.from(stdout.trim(), "base64")))
        },
      )
      child.stdin?.end(Buffer.from(bytes).toString("base64"))
    })
  }

  protect(bytes: Uint8Array) {
    return this.#run("protect", bytes)
  }
  unprotect(bytes: Uint8Array) {
    return this.#run("unprotect", bytes)
  }
}

/**
 * Which protection Codehouse uses: one it was given (tests), else the helper (no PowerShell), else DPAPI through
 * PowerShell on Windows, else none (other systems, until a port supplies its own, such as the Keychain on a Mac).
 * The helper is looked for only when nothing was given, because finding it may build it.
 */
export function sealerFor(o: {
  given?: Protector | undefined
  helper: () => string | undefined
  platform?: NodeJS.Platform
}): Protector {
  if (o.given) return o.given
  const exe = o.helper()
  if (exe) return new HelperProtector(exe)
  return (o.platform ?? process.platform) === "win32" ? new DpapiProtector() : new PlainProtector()
}

/** For tests on machines without DPAPI. It is not protection, and a test that uses it says so. */
export class PlainProtector implements Protector {
  async protect(bytes: Uint8Array) {
    return new Uint8Array(Buffer.concat([Buffer.from("plain:"), Buffer.from(bytes)]))
  }
  async unprotect(bytes: Uint8Array) {
    const b = Buffer.from(bytes)
    if (!b.subarray(0, 6).equals(Buffer.from("plain:")))
      throw new Error("not protected by this protector")
    return new Uint8Array(b.subarray(6))
  }
}
