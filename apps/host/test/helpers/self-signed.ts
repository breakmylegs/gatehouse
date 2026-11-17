// A self-signed certificate for 127.0.0.1, made with openssl (Git for Windows has one; macOS too), for tests that need
// a real TLS server. Node cannot make certificates itself. Undefined when no openssl is found, so a test can skip.
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const candidates = process.platform === "win32" ? ["C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "openssl"] : ["openssl", "/usr/bin/openssl"]

export const opensslPath: string | undefined = candidates.find((c) => {
  try {
    execFileSync(c, ["version"], { stdio: "ignore", windowsHide: true })
    return true
  } catch {
    return false
  }
})

export interface SelfSigned {
  key: string
  cert: string
  /** SHA-256 of the certificate's DER, as Codehouse pins it. */
  sha256: string
}

export function selfSigned(): SelfSigned {
  if (!opensslPath) throw new Error("no openssl")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-tls-"))
  try {
    // Neutral names: these are throw-away test files.
    const k = path.join(dir, "k.txt")
    const c = path.join(dir, "c.txt")
    execFileSync(
      opensslPath,
      ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", k, "-out", c, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
      { stdio: "ignore", windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
    )
    const cert = fs.readFileSync(c, "utf8")
    return { key: fs.readFileSync(k, "utf8"), cert, sha256: crypto.createHash("sha256").update(new crypto.X509Certificate(cert).raw).digest("hex") }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
