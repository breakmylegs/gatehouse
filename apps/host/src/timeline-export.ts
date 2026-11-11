/**
 * C-011, the signed timeline export (Frontier build, Wave 2 prerequisite). One session's timeline (C-010) in the audit
 * bundle (G30): the month files as they are, head.json, timeline.json, timeline.sig and timeline-key.json, and
 * verified.json with what both verifiers said of it when it was made. Changing one byte of the timeline, the head or a
 * record fails both verifiers (verify-timeline.ts and verify-audit.ps1).
 *
 * The key is an ECDSA P-256 pair made on this computer, its private half sealed for this Windows user (DPAPI) in the
 * data folder. ECDSA because Windows PowerShell 5.1's .NET Framework can check it and has no Ed25519. The key names
 * nothing but this install: its fingerprint, shown when an export is made, is what to compare.
 */
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { signedBytes, verifyAudit, verifyTimelineExport } from "@gatehouse/shared/audit"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { stageAuditBundle } from "./audit-bundle.js"
import type { Protector } from "./relay/protector.js"
import type { TimelineEntry } from "./timeline.js"
import { writeZip } from "./update/zip.js"

export class TimelineSigner {
  readonly #file: string
  readonly #sealer: () => Protector
  #key: crypto.KeyObject | undefined

  /** file: the sealed key's name in dir; D-029's anchors keep a key of their own. */
  constructor(o: { dir: string; sealer: () => Protector; file?: string }) {
    this.#file = path.join(o.dir, o.file ?? "timeline-key.sealed")
    this.#sealer = o.sealer
  }

  async #private(): Promise<crypto.KeyObject> {
    if (this.#key) return this.#key
    if (fs.existsSync(this.#file)) {
      const pem = Buffer.from(await this.#sealer().unprotect(fs.readFileSync(this.#file))).toString("utf8")
      this.#key = crypto.createPrivateKey(pem)
    } else {
      const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
      const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
      fs.mkdirSync(path.dirname(this.#file), { recursive: true })
      await writeFileAtomic(this.#file, Buffer.from(await this.#sealer().protect(Buffer.from(pem, "utf8"))))
      this.#key = privateKey
    }
    return this.#key
  }

  /** The public key, as a JWK holding only what checking needs. */
  async publicJwk(): Promise<{ kty: string; crv: string; x: string; y: string }> {
    const j = crypto.createPublicKey(await this.#private()).export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string }
    return { kty: j.kty, crv: j.crv, x: j.x, y: j.y }
  }

  /** The key's fingerprint: SHA-256 of its JWK's x and y, the first 16 hex characters, in fours. */
  async fingerprint(): Promise<string> {
    const j = await this.publicJwk()
    const hex = crypto.createHash("sha256").update(`${j.x}.${j.y}`).digest("hex").slice(0, 16)
    return hex.match(/.{4}/g)!.join("-")
  }

  async sign(data: Buffer): Promise<string> {
    return crypto.sign("sha256", data, { key: await this.#private(), dsaEncoding: "ieee-p1363" }).toString("base64")
  }
}

export const TIMELINE_NOTE = (fingerprint: string) => `This is one Codehouse session's timeline, signed, with the audit records it was made from.

To check that nothing in it was changed, removed or reordered (the timeline, its signature and the hash chain of the
records), unzip it into a folder of its own and run:

  powershell -NoProfile -ExecutionPolicy Bypass -File verify-audit.ps1 -Dir <that folder>

From a Codehouse source checkout, npm run audit:verify -- <that folder> does the same with Node.

The signing key's fingerprint is ${fingerprint}. Codehouse shows it when you export; compare the two.
verified.json says what both checks found when the export was made.
`

/** What the PowerShell verifier says of a folder, as JSON, or why it could not be asked. */
export function runPowerShellVerifier(script: string, dir: string): Promise<{ ok: boolean | null; problems?: unknown; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Dir", dir, "-Json"],
      { windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (_e, stdout) => {
        try {
          const r = JSON.parse(String(stdout).trim()) as { ok: boolean; problems?: unknown }
          resolve({ ok: r.ok, problems: r.problems })
        } catch {
          resolve({ ok: null, error: "Windows PowerShell did not answer, so only the Node check was made" })
        }
      },
    )
  })
}

interface ExportInput {
  auditDir: string
  session: string
  entries: TimelineEntry[]
  signer: TimelineSigner
  verifier: string
}

/** The export as a zip, made in a folder of its own under the temp folder and removed straight after. */
export async function makeTimelineExport(o: ExportInput): Promise<{ zip: Buffer; fingerprint: string; ok: boolean }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-timeline-"))
  try {
    const stage = path.join(dir, "export")
    fs.mkdirSync(stage)
    const { files, fingerprint, ok } = await stageTimelineExport(o, stage)
    const out = path.join(dir, "timeline.zip")
    await writeZip(out, stage, files, { date: new Date() })
    return { zip: fs.readFileSync(out), fingerprint, ok }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Puts the export's files in `stage`, checks them with both verifiers, and says what they found. */
export async function stageTimelineExport(
  o: ExportInput,
  stage: string,
): Promise<{ files: string[]; fingerprint: string; ok: boolean }> {
  const { files } = stageAuditBundle(o.auditDir, stage, o.verifier)
  const timeline = Buffer.from(JSON.stringify({ version: 1, session: o.session, entries: o.entries }, null, 1) + "\n", "utf8")
  fs.writeFileSync(path.join(stage, "timeline.json"), timeline)
  const head = fs.readFileSync(path.join(stage, "head.json"))
  fs.writeFileSync(path.join(stage, "timeline.sig"), (await o.signer.sign(signedBytes(timeline, head))) + "\n")
  fs.writeFileSync(path.join(stage, "timeline-key.json"), JSON.stringify(await o.signer.publicJwk()) + "\n")
  const fingerprint = await o.signer.fingerprint()
  fs.writeFileSync(path.join(stage, "VERIFY.txt"), TIMELINE_NOTE(fingerprint).replace(/\n/g, "\r\n"))
  // Both verifiers, on the export as it will be.
  const chain = verifyAudit(stage)
  const signed = verifyTimelineExport(stage)
  const node = { ok: chain.ok && signed.length === 0, records: chain.records, problems: [...chain.problems, ...signed] }
  const powershell = await runPowerShellVerifier(path.join(stage, "verify-audit.ps1"), stage)
  fs.writeFileSync(path.join(stage, "verified.json"), JSON.stringify({ at: new Date().toISOString(), node, powershell }, null, 1) + "\n")
  return {
    files: [...files, "timeline.json", "timeline.sig", "timeline-key.json", "verified.json"],
    fingerprint,
    ok: node.ok && powershell.ok !== false,
  }
}
