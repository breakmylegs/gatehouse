// O41: publishes a Codehouse Neighbourhood Watch update, so Update in CNW's own page can take it.
//
//   npm run release:cnw           sign cnw-update.json for the pushed HEAD and upload it to the cnw-latest release
//   npm run release:cnw -- --dry  sign and check it, and say what it would upload
//
// The manifest names CNW's version (apps/cnw/package.json, which must be newer each time) and the exact commit, which
// must already be on GitHub. It is signed with the release key that signs Codehouse's updates (scripts/release.ts says
// where it is kept) and checked against the public half CNW has built in before anything is uploaded.
//
// Codehouse's own update reads the repository's latest release (apps/host/src/update/source.ts), so cnw-latest is
// always a pre-release and never marked latest: publishing CNW can never take the place of a Codehouse release.
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CNW_RELEASE_KEYS } from "../apps/cnw/src/release-key.js"
import { verifyManifest, type UpdateManifest } from "../apps/cnw/src/updater.js"

export const CNW_TAG = "cnw-latest"

/** The manifest for a version and commit, as the bytes that are signed. */
export function manifestJson(m: UpdateManifest): string {
  return JSON.stringify({ version: m.version, commit: m.commit, ...(m.minFrom ? { minFrom: m.minFrom } : {}) })
}

/** Signs the manifest and checks the signature with CNW's own key; throws when it would not be accepted. */
export function signManifest(json: string, privateKeyPem: string, keys: readonly string[] = CNW_RELEASE_KEYS): string {
  const sig = crypto.sign(null, Buffer.from(json), crypto.createPrivateKey(privateKeyPem)).toString("base64")
  if (!keys.some((k) => verifyManifest(json, sig, k)))
    throw new Error("The signature does not verify with the key CNW has built in, so nothing was uploaded.")
  return sig
}

/**
 * The gh commands that publish the files: create the release if there is none, as a pre-release never marked latest,
 * or replace its files and keep it so.
 */
export function ghCommands(exists: boolean, files: string[], version: string): string[][] {
  const flags = ["--prerelease", "--latest=false"]
  return exists
    ? [
        ["release", "upload", CNW_TAG, ...files, "--clobber"],
        ["release", "edit", CNW_TAG, ...flags, "--title", `Codehouse Neighbourhood Watch ${version}`],
      ]
    : [
        [
          "release",
          "create",
          CNW_TAG,
          ...files,
          ...flags,
          "--title",
          `Codehouse Neighbourhood Watch ${version}`,
          "--notes",
          "The newest Codehouse Neighbourhood Watch. Update from CNW's own page; see docs/neighbourhood-watch.md.",
        ],
      ]
}

function releaseKey(): string {
  if (process.env.CODEHOUSE_RELEASE_KEY) return process.env.CODEHOUSE_RELEASE_KEY
  const file =
    process.env.CODEHOUSE_RELEASE_KEY_FILE ??
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".codehouse-release", "release-key.pem")
  if (!fs.existsSync(file))
    throw new Error(`No release key: set CODEHOUSE_RELEASE_KEY or CODEHOUSE_RELEASE_KEY_FILE, or put it at ${file}.`)
  return fs.readFileSync(file, "utf8")
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const dry = process.argv.includes("--dry")
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim()
  if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("The tree has changes; commit them first.")
  const commit = git("rev-parse", "HEAD")
  git("fetch", "-q", "origin")
  if (!git("branch", "-r", "--contains", commit).split("\n").some((b) => b.trim() === "origin/main"))
    throw new Error(`${commit.slice(0, 7)} is not on GitHub's main yet; push it first, so the updater can fetch it.`)
  const version = (JSON.parse(fs.readFileSync(path.join(root, "apps", "cnw", "package.json"), "utf8")) as { version: string }).version
  const json = manifestJson({ version, commit })
  const sig = signManifest(json, releaseKey())
  const out = path.join(root, "dist-cnw")
  fs.mkdirSync(out, { recursive: true })
  const files = [path.join(out, "cnw-update.json"), path.join(out, "cnw-update.sig")]
  fs.writeFileSync(files[0]!, json)
  fs.writeFileSync(files[1]!, sig)
  let exists = true
  try {
    execFileSync("gh", ["release", "view", CNW_TAG], { cwd: root, stdio: "ignore" })
  } catch {
    exists = false
  }
  const cmds = ghCommands(exists, files, version)
  if (dry) {
    for (const c of cmds) console.log(`[release:cnw] would run: gh ${c.join(" ")}`)
    return
  }
  for (const c of cmds) execFileSync("gh", c, { cwd: root, stdio: "inherit" })
  console.log(`[release:cnw] Codehouse Neighbourhood Watch ${version} (${commit.slice(0, 7)}) is out as ${CNW_TAG}.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    console.error(`[release:cnw] ${(e as Error).message}`)
    process.exit(1)
  }
}
