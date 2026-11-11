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
import { anchorFile, anchorMessage, readAnchors, type Anchor, type AuditHead } from "@gatehouse/shared/audit"
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
