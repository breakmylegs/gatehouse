import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/**
 * Uplift phase 5 (owner, 17 Nov): backup and restore of CNW's data. A backup holds every data file (people, settings,
 * paired computers, the Server page's settings, invites, the audit) and the sealing key, so the second factors still
 * open after a restore. It is therefore encrypted as a whole with a passphrase you choose (scrypt, then AES-256-GCM),
 * and nothing in it is readable without that passphrase. caddy's certificates are not in it: they live in caddy-data,
 * and a CNW restored onto a new caddy-data has a new certificate, so each computer pairs again.
 */
export const BACKUP_FILES = ["users.json", "settings.json", "computers.json", "server.json", "invites.json", "audit.json", "seal.key"] as const
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export function makeBackup(dataDir: string, passphrase: string, now = Date.now()): string {
  const files: Record<string, string> = {}
  for (const f of BACKUP_FILES) {
    try {
      files[f] = fs.readFileSync(path.join(dataDir, f), "utf8")
    } catch {
      // Not made yet: left out.
    }
  }
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT)
  const c = crypto.createCipheriv("aes-256-gcm", key, iv)
  const body = Buffer.concat([c.update(JSON.stringify({ v: 1, at: new Date(now).toISOString(), files })), c.final()])
  return ["cnw-backup", "v1", salt.toString("base64url"), iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".")
}

export class BackupError extends Error {}

/** Opens a backup with its passphrase: its files, only those CNW keeps, or a plain reason it cannot be used. */
export function openBackup(text: string, passphrase: string): { at: string; files: Record<string, string> } {
  const parts = text.trim().split(".")
  if (parts.length !== 6 || parts[0] !== "cnw-backup" || parts[1] !== "v1") throw new BackupError("That is not a Neighbourhood Watch backup.")
  let plain: Buffer
  try {
    const key = crypto.scryptSync(passphrase, Buffer.from(parts[2]!, "base64url"), 32, SCRYPT)
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[3]!, "base64url"))
    d.setAuthTag(Buffer.from(parts[4]!, "base64url"))
    plain = Buffer.concat([d.update(Buffer.from(parts[5]!, "base64url")), d.final()])
  } catch {
    throw new BackupError("The passphrase is not the one this backup was made with, or the file was changed.")
  }
  const j = JSON.parse(plain.toString("utf8")) as { v?: unknown; at?: unknown; files?: Record<string, unknown> }
  if (j.v !== 1 || !j.files || typeof j.files !== "object") throw new BackupError("That backup is from a version this CNW does not know.")
  const files: Record<string, string> = {}
  for (const f of BACKUP_FILES) if (typeof j.files[f] === "string") files[f] = j.files[f] as string
  // Each JSON file must be JSON, or nothing is restored.
  for (const [f, text2] of Object.entries(files))
    if (f.endsWith(".json"))
      try {
        JSON.parse(text2)
      } catch {
        throw new BackupError(`${f} in that backup is not readable.`)
      }
  if (!files["users.json"]) throw new BackupError("That backup has no people in it, so it was not used.")
  return { at: typeof j.at === "string" ? j.at : "", files }
}

/** Writes a backup's files into the data folder, each atomically; what CNW keeps in memory needs a restart after. */
export function restoreFiles(dataDir: string, files: Record<string, string>): void {
  fs.mkdirSync(dataDir, { recursive: true })
  for (const [f, text] of Object.entries(files)) {
    const file = path.join(dataDir, f)
    const tmp = `${file}.${process.pid}.restore.tmp`
    fs.writeFileSync(tmp, text, { mode: 0o600 })
    fs.renameSync(tmp, file)
  }
}
