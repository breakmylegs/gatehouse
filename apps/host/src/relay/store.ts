import fs from "node:fs"
import path from "node:path"
import { b64u, exportPublicKey, generateKeyPair, unb64u } from "@gatehouse/shared/e2e"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { Protector } from "./protector.js"
import type { PinnedPhone } from "./verify.js"

interface RelayLink {
  url: string
  deviceId: string
  /** The device token, protected (DPAPI), base64url. */
  tokenProtected: string
  rpId: string
  origin: string
}

interface File {
  v: 1
  relay?: RelayLink
  hostKey?: { pkcs8Protected: string; publicKey: string }
  phones: PinnedPhone[]
  /** Nonces already used by a phone, with the time after which they are no longer needed. */
  usedNonces: Record<string, number>
}

/**
 * What the Host keeps about the phone side: the Relay address and device token (DPAPI), the Host's own
 * key pair (private half DPAPI), the pinned passkeys and keys of paired phones, and used nonces.
 */
export class PhoneStore {
  #data: File = { v: 1, phones: [], usedNonces: {} }
  #tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly protector: Protector,
  ) {}

  load(): void {
    if (!fs.existsSync(this.file)) return
    const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as File
    if (raw.v !== 1) throw new Error("phone.json has an unknown version")
    this.#data = { ...raw, phones: raw.phones ?? [], usedNonces: raw.usedNonces ?? {} }
  }

  /** Writes are queued so two changes never interleave, and each is atomic. */
  #save(): Promise<void> {
    const text = JSON.stringify(this.#data, null, 2) + "\n"
    this.#tail = this.#tail.then(async () => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      await writeFileAtomic(this.file, text)
    })
    return this.#tail
  }

  relay(): RelayLink | undefined {
    return this.#data.relay
  }

  async setRelay(link: Omit<RelayLink, "tokenProtected"> & { token: string }): Promise<void> {
    const { token, ...rest } = link
    const prot = await this.protector.protect(new TextEncoder().encode(token))
    this.#data.relay = { ...rest, tokenProtected: b64u(prot) }
    await this.#save()
  }

  async clearRelay(): Promise<void> {
    delete this.#data.relay
    this.#data.phones = []
    await this.#save()
  }

  async token(): Promise<string | undefined> {
    const r = this.#data.relay
    if (!r) return undefined
    return new TextDecoder().decode(await this.protector.unprotect(unb64u(r.tokenProtected)))
  }

  /** The Host's long-lived key pair. Made on first use, private half protected on disk. */
  async hostKey(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
    if (!this.#data.hostKey) {
      const kp = await generateKeyPair(true)
      const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", kp.privateKey))
      this.#data.hostKey = {
        pkcs8Protected: b64u(await this.protector.protect(pkcs8)),
        publicKey: await exportPublicKey(kp.publicKey),
      }
      await this.#save()
    }
    const pkcs8 = await this.protector.unprotect(unb64u(this.#data.hostKey.pkcs8Protected))
    const privateKey = await globalThis.crypto.subtle.importKey(
      "pkcs8",
      pkcs8 as Uint8Array<ArrayBuffer>,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    )
    return { privateKey, publicKey: this.#data.hostKey.publicKey }
  }

  phones(): PinnedPhone[] {
    return [...this.#data.phones]
  }
  phone(id: string): PinnedPhone | undefined {
    return this.#data.phones.find((p) => p.id === id)
  }
  async addPhone(p: PinnedPhone): Promise<void> {
    this.#data.phones = [...this.#data.phones.filter((x) => x.id !== p.id), p]
    await this.#save()
  }
  async renamePhone(id: string, name: string): Promise<boolean> {
    const p = this.phone(id)
    if (!p) return false
    p.name = name
    await this.#save()
    return true
  }
  /** Revoking removes the pinned key at once, before anything is said to the Relay. */
  async removePhone(id: string): Promise<boolean> {
    const before = this.#data.phones.length
    this.#data.phones = this.#data.phones.filter((p) => p.id !== id)
    if (this.#data.phones.length === before) return false
    await this.#save()
    return true
  }
  async setCounter(id: string, counter: number): Promise<void> {
    const p = this.phone(id)
    if (p && counter > p.counter) {
      p.counter = counter
      await this.#save()
    }
  }

  nonceUsed(nonce: string): boolean {
    return Object.hasOwn(this.#data.usedNonces, nonce)
  }
  async useNonce(nonce: string, expiresAtMs: number, now: number): Promise<void> {
    for (const [n, exp] of Object.entries(this.#data.usedNonces))
      if (exp < now) delete this.#data.usedNonces[n]
    this.#data.usedNonces[nonce] = expiresAtMs
    await this.#save()
  }
}
