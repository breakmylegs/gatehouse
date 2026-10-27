import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Keeps secrets off the disk in the clear. On Windows this is DPAPI for the current user. */
export interface Protector {
  protect(bytes: Uint8Array): Promise<Uint8Array>
  unprotect(bytes: Uint8Array): Promise<Uint8Array>
}

const here = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SCRIPT = path.resolve(here, "../../../../scripts/dpapi.ps1")

export class DpapiProtector implements Protector {
  constructor(
    private readonly script = DEFAULT_SCRIPT,
    private readonly pwsh = "pwsh",
  ) {}

  #run(mode: "protect" | "unprotect", bytes: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.pwsh,
        ["-NoProfile", "-NonInteractive", "-File", this.script, mode],
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
