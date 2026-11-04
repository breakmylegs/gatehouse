import { execFile, spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Keeps secrets off the disk in the clear. On Windows this is DPAPI for the current user; on a Mac, a key in the
 * login Keychain.
 */
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

/** Runs /usr/bin/security with these arguments and this standard input, and gives back its exit code and output. */
export type SecurityRunner = (
  args: string[],
  stdin?: string,
) => Promise<{ code: number; stdout: string }>

const runSecurity: SecurityRunner = (args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "ignore"] })
    const chunks: Buffer[] = []
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000)
    child.stdout.on("data", (c: Buffer) => chunks.push(c))
    child.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout: Buffer.concat(chunks).toString("utf8") })
    })
    child.stdin.end(stdin ?? "")
  })

/** What `security find-generic-password` exits with when there is no such item. */
const NOT_FOUND = 44
const MAGIC = Buffer.from("kc1")
const IV = 12
const TAG = 16

/**
 * On a Mac: AES-256-GCM with a random key kept in the login Keychain, the nearest Mac match for DPAPI's current
 * user scope. The key is made on first use and never changed, since that would strand what it sealed. It reaches
 * `security` on standard input, never as an argument, so it is never in the process list. If the Keychain cannot
 * be read (locked, refused, or an item that is not a key) nothing is sealed or opened, and no new key replaces it.
 */
export class KeychainProtector implements Protector {
  #key: Promise<Buffer> | undefined

  constructor(
    private readonly run: SecurityRunner = runSecurity,
    private readonly service = "Codehouse",
    private readonly account = "sealing-key",
  ) {}

  async #find(): Promise<Buffer | undefined> {
    const r = await this.run(["find-generic-password", "-s", this.service, "-a", this.account, "-w"])
    if (r.code === NOT_FOUND) return undefined
    if (r.code !== 0) throw new Error(`Keychain read failed (security exited ${r.code})`)
    const hex = r.stdout.trim()
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("The Keychain item is not a Codehouse key")
    return Buffer.from(hex, "hex")
  }

  async #load(): Promise<Buffer> {
    const found = await this.#find()
    if (found) return found
    // Without -U an existing item is never overwritten, so if another process made the key first, theirs is kept
    // and read back below.
    const fresh = crypto.randomBytes(32).toString("hex")
    await this.run(
      ["-i"],
      `add-generic-password -s ${this.service} -a ${this.account} -w ${fresh}\n`,
    )
    const made = await this.#find()
    if (!made) throw new Error("The Keychain did not keep the Codehouse key")
    return made
  }

  #keyOnce(): Promise<Buffer> {
    this.#key ??= this.#load().catch((e: unknown) => {
      this.#key = undefined
      throw e
    })
    return this.#key
  }

  async protect(bytes: Uint8Array) {
    const key = await this.#keyOnce()
    const iv = crypto.randomBytes(IV)
    const c = crypto.createCipheriv("aes-256-gcm", key, iv)
    const body = Buffer.concat([c.update(bytes), c.final()])
    return new Uint8Array(Buffer.concat([MAGIC, iv, c.getAuthTag(), body]))
  }

  async unprotect(bytes: Uint8Array) {
    const b = Buffer.from(bytes)
    if (b.length < MAGIC.length + IV + TAG || !b.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error("not protected by this protector")
    const key = await this.#keyOnce()
    const iv = b.subarray(MAGIC.length, MAGIC.length + IV)
    const tag = b.subarray(MAGIC.length + IV, MAGIC.length + IV + TAG)
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv)
    d.setAuthTag(tag)
    return new Uint8Array(Buffer.concat([d.update(b.subarray(MAGIC.length + IV + TAG)), d.final()]))
  }
}

let keychain: KeychainProtector | undefined

/**
 * The protector for this computer: DPAPI on Windows and the Keychain on a Mac, the one Keychain protector shared so
 * the key is read once. Elsewhere there is none yet, and PlainProtector keeps the earlier behaviour.
 */
export function platformProtector(platform: NodeJS.Platform = process.platform): Protector {
  if (platform === "win32") return new DpapiProtector()
  if (platform === "darwin") return (keychain ??= new KeychainProtector())
  return new PlainProtector()
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
