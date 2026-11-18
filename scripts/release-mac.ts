// Mac fork (owner, 18 Nov): publishes a Mac release, which installed Mac copies update to in the app.
//
//   npm run release:mac                 checks, builds Codehouse.app, signs its parts and publishes them
//   npm run release:mac -- --dry        the same into dist-release-mac/, publishing nothing
//   npm run release:mac -- --new-key    makes the Mac release key, once (prints only its public half)
//
// A Mac release is its own GitHub release, tagged mac-v<version>, and is never Latest: Windows copies find their
// updates at releases/latest/download/update.json, so a Mac release there would leave them none. Mac copies find the
// newest at the mac-channel release (MAC_CHANNEL_TAG), which holds only update-mac.json and its signature. After
// publishing, this checks Latest is still a Windows release and puts it back if not. See docs/mac.md.
import { execFileSync, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { signRelease } from "../apps/host/src/update/manifest.js"
import {
  MAC_CHANNEL_TAG,
  MAC_PART_NAMES,
  MAC_PRODUCT,
  MAC_RELEASE_KEYS,
  MAC_UPDATE_FILE,
  MAC_UPDATE_SIGNATURE,
  isMacVersion,
  listMacFiles,
  macPartOf,
  macPartTrees,
  macTag,
  verifyMacRelease,
  type MacManifest,
} from "../apps/host/src/update/release-mac.js"
import { UPDATE_REPO } from "../apps/host/src/update/source.js"
import { writeZip } from "../apps/host/src/update/zip.js"
import { mismatched, publishRelease, type Ran, type Run } from "./release-upload.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const say = (t: string) => console.log(`[release-mac] ${t}`)

/** Where the Mac release key is kept: readable only by you, never in the repository. */
export const macKeyFile = (env: NodeJS.ProcessEnv = process.env): string =>
  env.CODEHOUSE_MAC_RELEASE_KEY_FILE || path.join(os.homedir(), ".codehouse-release", "mac-release-key.pem")

/** Makes the Mac release key, refusing to replace one. Returns only the public half; the private key is never shown. */
export function newMacKey(file: string): string {
  if (fs.existsSync(file)) throw new Error(`${file} already exists. A key is made once; it was left as it is.`)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" })
  fs.renameSync(tmp, file)
  return publicKey.export({ type: "spki", format: "pem" }).toString()
}

/** The public half of a private key, to check it is one the app trusts before anything is published. */
export const publicOf = (privatePem: string): string =>
  crypto.createPublicKey(crypto.createPrivateKey(privatePem)).export({ type: "spki", format: "pem" }).toString()

/** A part's archive name: never a Windows one (codeh-<version>-<part>.zip). */
export const macArchive = (version: string, part: string): string => `codeh-mac-${macTag(version).slice(5)}-${part}.zip`

export interface MacReleaseInput {
  app: string
  out: string
  version: string
  arch: "arm64" | "x64"
  commit?: string
  notes: string
  privatePem: string
  keys: readonly string[]
  now?: Date
}

/**
 * Zips each part of a built Codehouse.app (with modes and links), writes the signed description, and checks it reads
 * back as a release this Mac would accept. Returns the files to upload, the description and its signature last.
 */
export async function makeMacRelease(i: MacReleaseInput): Promise<{ files: string[]; manifest: MacManifest }> {
  if (!isMacVersion(i.version) || i.version.endsWith(".dev"))
    throw new Error(`${i.version} is not a Mac release version: build from a clean, pushed main.`)
  fs.mkdirSync(i.out, { recursive: true })
  const trees = await macPartTrees(i.app)
  const all = await listMacFiles(i.app)
  const parts: MacManifest["parts"] = []
  const files: string[] = []
  for (const name of MAC_PART_NAMES) {
    const archive = macArchive(i.version, name)
    const zip = path.join(i.out, archive)
    await writeZip(zip, i.app, all.filter((r) => macPartOf(r) === name), { unix: true })
    const bytes = fs.readFileSync(zip)
    parts.push({
      name,
      ...trees[name],
      archive,
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    })
    files.push(zip)
  }
  const manifest: MacManifest = {
    format: 1,
    product: MAC_PRODUCT,
    version: i.version,
    arch: i.arch,
    ...(i.commit ? { commit: i.commit } : {}),
    publishedAt: (i.now ?? new Date()).toISOString(),
    notes: i.notes,
    parts,
  }
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n")
  const sig = signRelease(bytes, i.privatePem)
  const back = verifyMacRelease(bytes, sig, i.keys, i.arch)
  if (!back.ok) throw new Error(`The release does not check as a Mac copy would check it: ${back.error}`)
  fs.writeFileSync(path.join(i.out, MAC_UPDATE_FILE), bytes)
  fs.writeFileSync(path.join(i.out, MAC_UPDATE_SIGNATURE), sig + "\n")
  return { files: [...files, path.join(i.out, MAC_UPDATE_FILE), path.join(i.out, MAC_UPDATE_SIGNATURE)], manifest }
}

/**
 * Latest must stay a Windows release (v<number>): Windows copies read releases/latest. If anything has made a Mac
 * release Latest, the newest Windows release is made Latest again. Returns what it found and what it did.
 */
export function keepWindowsLatest(run: Run, repo: string): string {
  const latest = run("gh", ["api", `repos/${repo}/releases/latest`, "--jq", ".tag_name"])
  const tag = latest.stdout.trim()
  if (latest.status === 0 && /^v\d+\.\d+\.\d+$/.test(tag)) return `Latest is still ${tag}, a Windows release.`
  const list = run("gh", ["release", "list", "--repo", repo, "--limit", "100", "--json", "tagName,isDraft,isPrerelease"])
  if (list.status !== 0) throw new Error(`Latest is ${tag || "unknown"}, and the releases could not be listed to put it back.`)
  const windows = (JSON.parse(list.stdout) as Array<{ tagName: string; isDraft: boolean; isPrerelease: boolean }>)
    .filter((r) => !r.isDraft && !r.isPrerelease && /^v\d+\.\d+\.\d+$/.test(r.tagName))
    .map((r) => r.tagName)
    .sort((a, b) => {
      const n = (t: string) => t.slice(1).split(".").map(Number)
      const [x, y] = [n(a), n(b)]
      return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!
    })
  const newest = windows[0]
  if (!newest) throw new Error(`Latest is ${tag || "unknown"}, and there is no Windows release to make Latest.`)
  const put = run("gh", ["release", "edit", newest, "--repo", repo, "--latest"])
  if (put.status !== 0) throw new Error(`Latest is ${tag}; ${newest} could not be made Latest again: ${put.stderr.trim()}`)
  return `Latest had become ${tag || "nothing"}; ${newest} is Latest again.`
}

/** Puts the newest description and signature on the mac-channel release, made (never Latest) the first time. */
export function refreshChannel(run: Run, repo: string, files: string[], target: string): void {
  const view = (): Ran => run("gh", ["release", "view", MAC_CHANNEL_TAG, "--repo", repo, "--json", "isDraft,assets"])
  if (view().status !== 0) {
    const made = run("gh", [
      "release", "create", MAC_CHANNEL_TAG, "--repo", repo, "--latest=false", "--target", target,
      "--title", "Codehouse for Mac: the newest release",
      "--notes", "Codehouse for Mac checks this release for its updates. Mac releases are tagged mac-v<version>.",
    ])
    if (made.status !== 0) throw new Error(`The ${MAC_CHANNEL_TAG} release could not be made: ${made.stderr.trim()}`)
  }
  for (const f of files) {
    const up = run("gh", ["release", "upload", MAC_CHANNEL_TAG, f, "--repo", repo, "--clobber"])
    if (up.status !== 0) throw new Error(`${path.basename(f)} could not be put on ${MAC_CHANNEL_TAG}: ${up.stderr.trim()}`)
  }
  const after = view()
  const bad = after.status === 0 ? mismatched(files, (JSON.parse(after.stdout) as { assets: [] }).assets) : files
  if (bad.length) throw new Error(`On ${MAC_CHANNEL_TAG} these do not match the ones here: ${bad.join(", ")}.`)
}

const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim()
const sh: Run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8" })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

async function ship(dry: boolean): Promise<void> {
  if (process.platform !== "darwin") throw new Error("A Mac release is built on a Mac.")
  const keyFile = macKeyFile()
  if (!fs.existsSync(keyFile)) throw new Error(`No Mac release key at ${keyFile}. Make one with npm run release:mac -- --new-key.`)
  const privatePem = fs.readFileSync(keyFile, "utf8")
  if (!MAC_RELEASE_KEYS.includes(publicOf(privatePem)))
    throw new Error("The Mac release key's public half is not in MAC_RELEASE_KEYS (release-mac.ts), so no Mac copy would accept this release.")
  if (!dry) {
    git("fetch", "-q", "origin", "--tags")
    if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("The working copy has changes. Commit and push them first.")
    if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) throw new Error("HEAD is not origin/main. A Mac release is made from pushed main.")
  }
  say("building and checking Codehouse.app")
  execFileSync(process.execPath, [path.join(root, "scripts", "package-mac.mjs"), "--check"], { cwd: root, stdio: "inherit" })
  const app = path.join(root, "dist-app", "Codehouse.app")
  const version = execFileSync("/usr/bin/plutil", ["-extract", "CodehouseVersion", "raw", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim()
  const tag = macTag(version)
  const before = sh("git", ["describe", "--tags", "--abbrev=0", "--match", "mac-v*", "HEAD"])
  const since = before.status === 0 ? `${before.stdout.trim()}..HEAD` : "HEAD~20..HEAD"
  const notes = git("log", "--no-merges", "--format=- %s", since) || "- Codehouse for Mac."
  const out = path.join(root, "dist-release-mac")
  fs.rmSync(out, { recursive: true, force: true })
  say(`making ${tag}: zipping and signing its parts`)
  const { files } = await makeMacRelease({
    app, out, version, arch: process.arch === "x64" ? "x64" : "arm64", commit: git("rev-parse", "HEAD"), notes, privatePem, keys: MAC_RELEASE_KEYS,
  })
  if (dry) return say(`made in ${out}, published nothing`)
  const notesFile = path.join(out, "notes.md")
  fs.writeFileSync(notesFile, `Codehouse for Mac ${version}. It updates to this in the app.\n\n${notes}\n`)
  publishRelease({ run: sh, repo: UPDATE_REPO, tag, title: `Codehouse for Mac ${version}`, notesFile, target: git("rev-parse", "HEAD"), files, latest: false })
  refreshChannel(sh, UPDATE_REPO, files.slice(-2), git("rev-parse", "HEAD"))
  say(keepWindowsLatest(sh, UPDATE_REPO))
  say(`published ${tag}; Mac copies offer it within their next check`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const go = args.includes("--new-key")
    ? Promise.resolve().then(() => {
        const pub = newMacKey(macKeyFile())
        say(`made ${macKeyFile()}, readable only by you. Back it up somewhere safe: without it no Mac copy accepts a new release.`)
        say("Its public half, for MAC_RELEASE_KEYS in apps/host/src/update/release-mac.ts:")
        console.log(pub)
      })
    : ship(args.includes("--dry"))
  go.catch((e: Error) => {
    console.error(`[release-mac] ${e.message}`)
    process.exit(1)
  })
}
