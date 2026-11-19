import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AddedDependency } from "./dependencies.js"

/**
 * D-063 (frontier, safe variant): NuGet package provenance, offline. A NuGet package is signed when its .nupkg holds a
 * .signature.p7s entry (the author's or nuget.org's repository signature); a new package whose .nupkg on this computer
 * has none escalates as nuget-unsigned. It reads the archive's own directory only, never extracts or runs anything, and
 * needs no network. Checking that a signature is valid needs `dotnet nuget verify`, a separate process the Host would
 * run; the policy engine stays pure, so that check is listed, not done here. A package not downloaded yet cannot be
 * read, and D-053 already asks about every new package.
 */
export const NUGET_UNSIGNED = "nuget-unsigned"

/** The names of the entries in a zip archive, from its central directory; undefined when it cannot be read. */
export function zipEntries(file: string): string[] | undefined {
  let buf: Buffer
  try {
    buf = fs.readFileSync(file)
  } catch {
    return undefined
  }
  // The end of central directory record: its signature, searched for from the end (a comment may follow it).
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) return undefined
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const names: string[] = []
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return undefined
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    names.push(buf.subarray(at + 46, at + 46 + nameLen).toString("utf8"))
    at += 46 + nameLen + extraLen + commentLen
  }
  return names
}

/** Whether a .nupkg is signed: true, false, or undefined when it cannot be read. */
export function nupkgSigned(file: string): boolean | undefined {
  const names = zipEntries(file)
  return names === undefined ? undefined : names.includes(".signature.p7s")
}

/** The newest downloaded .nupkg of a package, in the NuGet package folder. */
function nupkgOf(id: string, home: string): string | undefined {
  const dir = path.join(home, ".nuget", "packages", id.toLowerCase())
  let versions: string[] = []
  try {
    versions = fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  } catch {
    return undefined
  }
  const v = versions[versions.length - 1]
  if (!v) return undefined
  const file = path.join(dir, v, `${id.toLowerCase()}.${v}.nupkg`)
  return fs.existsSync(file) ? file : undefined
}

export interface SignatureFinding {
  outcome: "escalate"
  ruleId: typeof NUGET_UNSIGNED
  reason: string
  risk: number
  dependency: string
}

/** What to do about each new NuGet package's signature: escalate an unsigned one; nothing for one signed or not here. */
export function nugetSignatureFindings(added: AddedDependency[], home = process.env.USERPROFILE ?? os.homedir()): SignatureFinding[] {
  const out: SignatureFinding[] = []
  for (const d of added) {
    if (d.ecosystem !== "nuget") continue
    const file = nupkgOf(d.name, home)
    if (!file || nupkgSigned(file) !== false) continue
    out.push({
      outcome: "escalate",
      ruleId: NUGET_UNSIGNED,
      reason: `It adds ${d.name} (NuGet), whose package on this computer carries no signature, so where it came from cannot be shown. Check it is the package you meant before you allow it.`,
      risk: 76,
      dependency: `nuget:${d.name}`,
    })
  }
  return out
}
