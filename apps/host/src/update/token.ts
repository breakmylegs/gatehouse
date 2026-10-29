/**
 * A GitHub token for updates, only needed while the JCVC repository is private. Kept sealed with Windows DPAPI,
 * read into memory at start, never shown again and only ever sent to api.github.com.
 */
import fs from "node:fs"
import path from "node:path"
import type { Protector } from "../relay/protector.js"

export const TOKEN_SHAPE = /^(gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/

export class UpdateTokenStore {
  readonly #file: string
  readonly #protector: Protector
  #token: string | undefined

  constructor(file: string, protector: Protector) {
    this.#file = file
    this.#protector = protector
  }

  async load(): Promise<void> {
    if (!fs.existsSync(this.#file)) return
    try {
      const plain = Buffer.from(
        await this.#protector.unprotect(new Uint8Array(fs.readFileSync(this.#file))),
      ).toString("utf8")
      this.#token = TOKEN_SHAPE.test(plain) ? plain : undefined
    } catch {
      this.#token = undefined
    }
  }

  get(): string | undefined {
    return this.#token
  }

  async save(token: string): Promise<void> {
    if (!TOKEN_SHAPE.test(token)) throw new Error("That does not look like a GitHub token.")
    const sealed = await this.#protector.protect(Buffer.from(token, "utf8"))
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    const tmp = this.#file + ".tmp"
    fs.writeFileSync(tmp, sealed)
    fs.renameSync(tmp, this.#file)
    this.#token = token
  }

  forget(): void {
    fs.rmSync(this.#file, { force: true })
    this.#token = undefined
  }
}
