// Certificate chains shaped like caddy's own authority (tls internal): a root, an intermediate, and a leaf for an
// address, each made with openssl (Git for Windows has one; macOS too). A leaf can be made again with a new key under
// the same intermediate, as caddy renews it every few hours. Undefined openssl: the tests that need it skip.
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { opensslPath } from "./self-signed.js"

export { opensslPath }

export interface Issued {
  key: string
  cert: string
}

const ssl = (args: string[]) => execFileSync(opensslPath!, args, { stdio: "ignore", windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" } })

function inDir<T>(f: (p: (n: string) => string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-ca-"))
  try {
    return f((n) => path.join(dir, n))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"]

/** A self-signed root certificate authority. */
export function makeRoot(name = "Test Local Authority - Root"): Issued {
  return inDir((p) => {
    ssl(["req", "-x509", ...ec, "-keyout", p("k.txt"), "-out", p("c.txt"), "-days", "3", "-subj", `/CN=${name}`, "-extensions", "v3", "-config", writeConfig(p)])
    return { key: fs.readFileSync(p("k.txt"), "utf8"), cert: fs.readFileSync(p("c.txt"), "utf8") }
  })
}

function writeConfig(p: (n: string) => string): string {
  fs.writeFileSync(p("req.cnf"), "[req]\ndistinguished_name=dn\n[dn]\n[v3]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n")
  return p("req.cnf")
}

function sign(issuer: Issued, subject: string, ext: string, days: string): Issued {
  return inDir((p) => {
    fs.writeFileSync(p("ik.txt"), issuer.key)
    fs.writeFileSync(p("ic.txt"), issuer.cert)
    fs.writeFileSync(p("ext.txt"), ext)
    fs.writeFileSync(p("req.cnf"), "[req]\ndistinguished_name=dn\n[dn]\n")
    ssl(["req", "-new", ...ec, "-keyout", p("k.txt"), "-out", p("r.txt"), "-subj", `/CN=${subject}`, "-config", p("req.cnf")])
    ssl(["x509", "-req", "-in", p("r.txt"), "-CA", p("ic.txt"), "-CAkey", p("ik.txt"), "-set_serial", `0x${crypto.randomBytes(8).toString("hex")}`, "-days", days, "-extfile", p("ext.txt"), "-out", p("c.txt")])
    return { key: fs.readFileSync(p("k.txt"), "utf8"), cert: fs.readFileSync(p("c.txt"), "utf8") }
  })
}

/** An intermediate authority under a root, as caddy keeps for about a week. */
export const makeIntermediate = (root: Issued): Issued =>
  sign(root, "Test Local Authority - Intermediate", "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n", "2")

/** A leaf for an IP address under an intermediate, with a new key each time, as caddy renews it. */
export const makeLeaf = (intermediate: Issued, ip = "127.0.0.1"): Issued =>
  sign(intermediate, ip, `subjectAltName=IP:${ip}\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n`, "1")

/** What a TLS server presents: the leaf's key, and the leaf with the intermediate after it (caddy sends no root). */
export const served = (leaf: Issued, intermediate: Issued): { key: string; cert: string } => ({ key: leaf.key, cert: leaf.cert + intermediate.cert })

export const sha256Of = (pem: string): string => crypto.createHash("sha256").update(new crypto.X509Certificate(pem).raw).digest("hex")
