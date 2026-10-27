import { createHash, randomBytes, webcrypto } from "node:crypto"

/**
 * A software passkey for tests. It produces genuine WebAuthn registration (attestation "none") and
 * assertion responses, signed with ES256, so the real @simplewebauthn verification code is what runs.
 */
const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url")
const sha = (b: Uint8Array | Buffer | string) => createHash("sha256").update(b).digest()

function cborUint(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 256) return Buffer.from([(major << 5) | 24, n])
  return Buffer.from([(major << 5) | 25, n >> 8, n & 255])
}
const cInt = (n: number) => (n >= 0 ? cborUint(0, n) : cborUint(1, -1 - n))
const cBytes = (b: Buffer) => Buffer.concat([cborUint(2, b.length), b])
const cText = (s: string) => Buffer.concat([cborUint(3, Buffer.byteLength(s)), Buffer.from(s)])
const cMap = (pairs: Array<[Buffer, Buffer]>) =>
  Buffer.concat([cborUint(5, pairs.length), ...pairs.flat()])

/** ECDSA from WebCrypto is r||s. WebAuthn wants an ASN.1 DER sequence. */
function toDer(raw: Buffer): Buffer {
  const part = (b: Buffer) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    let v = b.subarray(i)
    if (v[0]! & 0x80) v = Buffer.concat([Buffer.from([0]), v])
    return Buffer.concat([Buffer.from([2, v.length]), v])
  }
  const body = Buffer.concat([part(raw.subarray(0, 32)), part(raw.subarray(32))])
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

export class FakeAuthenticator {
  readonly credentialId = b64u(randomBytes(32))
  counter = 0
  /** Set false to model a passkey that fails user verification. */
  userVerified = true
  #priv!: webcrypto.CryptoKey
  #x!: Buffer
  #y!: Buffer

  static async create(): Promise<FakeAuthenticator> {
    const a = new FakeAuthenticator()
    const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])
    a.#priv = kp.privateKey
    const raw = Buffer.from(await webcrypto.subtle.exportKey("raw", kp.publicKey))
    a.#x = raw.subarray(1, 33)
    a.#y = raw.subarray(33, 65)
    return a
  }

  get coseKey(): Buffer {
    return cMap([
      [cInt(1), cInt(2)],
      [cInt(3), cInt(-7)],
      [cInt(-1), cInt(1)],
      [cInt(-2), cBytes(this.#x)],
      [cInt(-3), cBytes(this.#y)],
    ])
  }

  #flags(attested: boolean): number {
    return 0x01 | (this.userVerified ? 0x04 : 0) | (attested ? 0x40 : 0)
  }

  register(o: { challenge: string; rpId: string; origin: string }) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: o.challenge,
        origin: o.origin,
        crossOrigin: false,
      }),
    )
    const id = Buffer.from(this.credentialId, "base64url")
    const authData = Buffer.concat([
      sha(o.rpId),
      Buffer.from([this.#flags(true)]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      Buffer.from([id.length >> 8, id.length & 255]),
      id,
      this.coseKey,
    ])
    const attestationObject = cMap([
      [cText("fmt"), cText("none")],
      [cText("attStmt"), cMap([])],
      [cText("authData"), cBytes(authData)],
    ])
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    }
  }

  async assert(o: { challenge: string; rpId: string; origin: string; counter?: number }) {
    this.counter = o.counter ?? this.counter + 1
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: o.challenge,
        origin: o.origin,
        crossOrigin: false,
      }),
    )
    const c = Buffer.alloc(4)
    c.writeUInt32BE(this.counter)
    const authData = Buffer.concat([sha(o.rpId), Buffer.from([this.#flags(false)]), c])
    const sig = Buffer.from(
      await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.#priv,
        Buffer.concat([authData, sha(clientDataJSON)]),
      ),
    )
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(toDer(sig)),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    }
  }
}
