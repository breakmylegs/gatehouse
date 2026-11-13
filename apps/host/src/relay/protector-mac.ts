import { spawn } from "node:child_process"
import crypto from "node:crypto"
import type { Protector } from "./protector.js"

// Mac fork: sealing secrets on a Mac. Kept out of protector.ts so upstream's changes merge without conflicts;
// sealerFor() in protector.ts chooses this on a Mac, in the place upstream left for a port (see docs/mac.md).

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
    const r = await this.run([
      "find-generic-password",
      "-s",
      this.service,
      "-a",
      this.account,
      "-w",
    ])
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

let shared: KeychainProtector | undefined

/** The one Keychain protector a Host uses, so the key is read from the Keychain once. */
export function keychainProtector(): KeychainProtector {
  return (shared ??= new KeychainProtector())
}
