/**
 * D-029, audit anchoring (Frontier build, Wave 2). Once a day, and when you ask on the Audit page, the audit chain's
 * head is signed and kept in a git repository of its own in the data folder (anchors\), as a file and an annotated tag
 * whose message is the anchor. Rewriting a record from before an anchor changes every hash after it, so both
 * verifiers find it. This computer's key (ECDSA P-256, sealed with Windows DPAPI) signs, and its anchors are marked
 * weaker, because anyone who can act as this Windows account could sign with it too. Each anchor is recorded as
 * anchor_signed. A failure is logged and tried again; it never stops a session.
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { convertCOSEtoPKCS } from "@simplewebauthn/server/helpers"
import { anchorFile, anchorMessage, listAuditFiles, readAnchors, type Anchor, type AuditHead, type PhoneAnchor } from "@gatehouse/shared/audit"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "./hostaudit.js"
import type { TimelineSigner } from "./timeline-export.js"

export const ANCHOR_EVERY_MS = 24 * 60 * 60_000

type Git = (cwd: string, args: string[]) => Promise<string>

const git: Git = (cwd, args) =>
  new Promise((resolve, reject) =>
    execFile(
      "git",
      // Codehouse's own repository: its own name, and never a signing program of yours, which could wait for a PIN.
      ["-c", "user.name=Codehouse", "-c", "user.email=codehouse@localhost", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
      { cwd, windowsHide: true, timeout: 20_000 },
      (e, out) => (e ? reject(e) : resolve(String(out))),
    ),
  )

export class AnchorService {
  readonly #dir: string
  readonly #auditDir: string
  readonly #signer: Pick<TimelineSigner, "sign" | "publicJwk" | "fingerprint">
  readonly #audit: Pick<HostAudit, "record">
  readonly #log: (line: string) => void
  readonly #git: Git
  readonly #now: () => Date
  #timer: NodeJS.Timeout | undefined
  #busy: Promise<Anchor | undefined> | undefined

  constructor(o: {
    dir: string
    auditDir: string
    signer: Pick<TimelineSigner, "sign" | "publicJwk" | "fingerprint">
    audit: Pick<HostAudit, "record">
    log: (line: string) => void
    git?: Git
    now?: () => Date
  }) {
    this.#dir = o.dir
    this.#auditDir = o.auditDir
    this.#signer = o.signer
    this.#audit = o.audit
    this.#log = o.log
    this.#git = o.git ?? git
    this.#now = o.now ?? (() => new Date())
  }

  /** The anchors so far, newest first. */
  list(): Anchor[] {
    return readAnchors(this.#dir)
      .flatMap((x) => (x.anchor ? [x.anchor] : []))
      .reverse()
  }

  /** Signs the chain's head now, unless the newest anchor already holds it. Recorded as anchor_signed. */
  anchor(why: "daily" | "on demand"): Promise<Anchor | undefined> {
    this.#busy ??= this.#anchor(why).finally(() => (this.#busy = undefined))
    return this.#busy
  }

  async #anchor(why: "daily" | "on demand"): Promise<Anchor | undefined> {
    let head: AuditHead
    try {
      head = JSON.parse(fs.readFileSync(path.join(this.#auditDir, "head.json"), "utf8")) as AuditHead
    } catch {
      return undefined
    }
    const last = this.list()[0]
    if (last && last.seq === head.seq && last.hash === head.hash) return last
    const ts = this.#now().toISOString()
    const anchor: Anchor = {
      v: 1,
      seq: head.seq,
      hash: head.hash,
      ts,
      signer: "local",
      strength: "weaker",
      fingerprint: await this.#signer.fingerprint(),
      sig: await this.#signer.sign(Buffer.from(anchorMessage({ seq: head.seq, hash: head.hash, ts }), "utf8")),
    }
    fs.mkdirSync(this.#dir, { recursive: true })
    const keyFile = path.join(this.#dir, "key.json")
    if (!fs.existsSync(keyFile)) await writeFileAtomic(keyFile, `${JSON.stringify(await this.#signer.publicJwk(), null, 2)}\n`)
    const file = anchorFile(head.seq)
    const json = `${JSON.stringify(anchor, null, 2)}\n`
    await writeFileAtomic(path.join(this.#dir, file), json)
    // The repository keeps when each anchor was made; the files are what the verifiers read.
    try {
      if (!fs.existsSync(path.join(this.#dir, ".git"))) await this.#git(this.#dir, ["init", "-q"])
      await this.#git(this.#dir, ["add", "key.json", file])
      await this.#git(this.#dir, ["commit", "-q", "-m", `anchor ${head.seq} (${why})`])
      await this.#git(this.#dir, ["tag", "-a", `anchor-${head.seq}`, "-m", JSON.stringify(anchor)])
    } catch (e) {
      this.#log(`audit anchor ${head.seq} kept without its git tag: ${(e as Error).message.slice(0, 200)}`)
    }
    await this.#audit.record({
      session: "host",
      event: "anchor_signed",
      channel: "host",
      tool: "audit",
      input: { seq: head.seq, hash: head.hash, signer: anchor.signer, strength: anchor.strength, why },
      verdict: {
        outcome: "allow",
        ruleId: "audit-anchor",
        reason: `The audit log was anchored at record ${head.seq} (${why}), signed on this computer.`,
        risk: 0,
        decidedBy: "rules",
        policyHash: "n/a",
      },
      latencyMs: 0,
    })
    return anchor
  }

  /**
   * D-029b: an anchor you signed on your phone with its passkey. The phone relay service has already checked the
   * assertion against the pinned passkey (invariant 8); here the record must be in the log with the hash it names.
   * The phone's public key is kept in phones.json, so the verifiers can check it without the Host.
   */
  async phone(o: {
    phoneId: string
    phoneName: string
    /** The pinned passkey's COSE public key, base64url. */
    credentialPublicKey: string
    envelope: PhoneAnchor["envelope"]
    assertion: PhoneAnchor["assertion"]
  }): Promise<PhoneAnchor> {
    const { seq, hash } = o.envelope.anchor
    if (recordHash(this.#auditDir, seq) !== hash) throw new Error(`Record ${seq} is not in the log with the hash the phone signed.`)
    const point = convertCOSEtoPKCS(Buffer.from(o.credentialPublicKey, "base64url"))
    if (point.length !== 65 || point[0] !== 4) throw new Error("The phone's passkey is not a P-256 key.")
    const jwk = { kty: "EC", crv: "P-256", x: Buffer.from(point.slice(1, 33)).toString("base64url"), y: Buffer.from(point.slice(33)).toString("base64url") }
    fs.mkdirSync(this.#dir, { recursive: true })
    const phonesFile = path.join(this.#dir, "phones.json")
    let phones: Record<string, unknown> = {}
    try {
      phones = JSON.parse(fs.readFileSync(phonesFile, "utf8")) as Record<string, unknown>
    } catch {
      // the first phone anchor
    }
    if (JSON.stringify(phones[o.phoneId]) !== JSON.stringify(jwk)) await writeFileAtomic(phonesFile, `${JSON.stringify({ ...phones, [o.phoneId]: jwk }, null, 2)}\n`)
    const anchor: PhoneAnchor = {
      v: 1,
      seq,
      hash,
      ts: String(o.envelope.issuedAt ?? this.#now().toISOString()),
      signer: "phone",
      strength: "passkey",
      phone: o.phoneId,
      envelope: o.envelope,
      assertion: { authenticatorData: o.assertion.authenticatorData, clientDataJSON: o.assertion.clientDataJSON, signature: o.assertion.signature },
    }
    const file = anchorFile(seq, true)
    await writeFileAtomic(path.join(this.#dir, file), `${JSON.stringify(anchor, null, 2)}\n`)
    try {
      if (!fs.existsSync(path.join(this.#dir, ".git"))) await this.#git(this.#dir, ["init", "-q"])
      await this.#git(this.#dir, ["add", "phones.json", file])
      await this.#git(this.#dir, ["commit", "-q", "-m", `anchor ${seq} (signed on ${o.phoneName})`])
      await this.#git(this.#dir, ["tag", "-a", `anchor-${seq}-phone`, "-m", JSON.stringify({ seq, hash, phone: o.phoneId })])
    } catch (e) {
      this.#log(`audit anchor ${seq} from the phone kept without its git tag: ${(e as Error).message.slice(0, 200)}`)
    }
    await this.#audit.record({
      session: "phone",
      event: "anchor_signed",
      channel: "phone",
      tool: "audit",
      input: { seq, hash, signer: "phone", strength: "passkey", phone: o.phoneId },
      verdict: {
        outcome: "allow",
        ruleId: "audit-anchor",
        reason: `You anchored the audit log at record ${seq} on ${o.phoneName}, signed with its passkey.`,
        risk: 0,
        decidedBy: "human-phone",
        policyHash: "n/a",
      },
      latencyMs: 0,
    })
    return anchor
  }

  /** The chain's head now, for the phone to sign. */
  head(): { seq: number; hash: string } | undefined {
    try {
      const h = JSON.parse(fs.readFileSync(path.join(this.#auditDir, "head.json"), "utf8")) as AuditHead
      return { seq: h.seq, hash: h.hash }
    } catch {
      return undefined
    }
  }

  /** Anchors at start if the last is a day old, then checks every hour. */
  start(): void {
    if (this.#timer) return
    const due = () => {
      const last = this.list()[0]
      if (!last || this.#now().getTime() - Date.parse(last.ts) >= ANCHOR_EVERY_MS)
        void this.anchor("daily").catch((e: Error) => this.#log(`audit anchor failed: ${e.message.slice(0, 200)}`))
    }
    due()
    this.#timer = setInterval(due, 60 * 60_000)
    this.#timer.unref?.()
  }

  stop(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
  }
}

/** A record's hash, read from the log by its seq. */
function recordHash(auditDir: string, seq: number): string | undefined {
  for (const file of listAuditFiles(auditDir).reverse()) {
    let text: string
    try {
      text = fs.readFileSync(path.join(auditDir, file), "utf8")
    } catch {
      continue
    }
    for (const line of text.split("\n")) {
      if (!line.includes(`"seq":${seq},`)) continue
      try {
        const r = JSON.parse(line) as { seq?: number; hash?: string }
        if (r.seq === seq) return r.hash
      } catch {
        // a damaged line
      }
    }
  }
  return undefined
}
