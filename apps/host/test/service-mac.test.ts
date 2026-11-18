// Mac fork (18 Nov): the Mac in-app updater's service (service-mac.ts) and its staging (stage-mac.ts), against a stand-in
// for GitHub serving a real signed Mac release of a small app: it finds it, builds the new app beside the installed one
// (unchanged parts cloned, the rest downloaded and checked), hands over to the updater with a plan inside its own
// folder, refuses a part that does not match, and does not offer again a version that would not start.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeMacRelease, newMacKey } from "../../../scripts/release-mac.js"
import { macPartTrees } from "../src/update/release-mac.js"
import { MacUpdateService, appVersion } from "../src/update/service-mac.js"
import type { UpdateSettings } from "../src/update/service.js"
import { UpdateError, type UpdateSource } from "../src/update/source.js"
import { stageMacRelease } from "../src/update/stage-mac.js"

let root: string
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gh-service-mac-")))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

/** A small Codehouse.app: its version in Info.plist, the updater, Node, a package and a workspace link. */
function makeApp(where: string, version: string, o: { node?: string } = {}) {
  const c = (rel: string, text: string, mode = 0o644) => {
    fs.mkdirSync(path.dirname(path.join(where, rel)), { recursive: true })
    fs.writeFileSync(path.join(where, rel), text, { mode })
  }
  c("Contents/Info.plist", `<plist><dict><key>CodehouseVersion</key>\n<string>${version}</string></dict></plist>`)
  c("Contents/MacOS/Codehouse", "program", 0o755)
  c("Contents/Resources/codehouse-update.sh", "# updater", 0o755)
  c("Contents/Resources/app/packages/policy/index.js", `policy ${version}`)
  c("Contents/Resources/app/node_modules/zod/index.js", "zod")
  c("Contents/Resources/runtime/node", o.node ?? "node 24", 0o755)
  fs.mkdirSync(path.join(where, "Contents/Resources/app/node_modules/@gatehouse"), { recursive: true })
  fs.symlinkSync("../../packages/policy", path.join(where, "Contents/Resources/app/node_modules/@gatehouse/policy"))
  return where
}

/** A signed Mac release of a new app, served from a folder: what GitHub would hand out. */
async function release(version: string, o: { node?: string } = {}) {
  const keyFile = path.join(root, `key-${crypto.randomUUID()}.pem`)
  const pub = newMacKey(keyFile)
  const src = makeApp(path.join(root, `build-${version}`, "Codehouse.app"), version, o)
  const out = path.join(root, `release-${version}`)
  await makeMacRelease({ app: src, out, version, arch: "arm64", notes: "- new", privatePem: fs.readFileSync(keyFile, "utf8"), keys: [pub] })
  const downloads: string[] = []
  const source: UpdateSource = {
    describe: () => "a stand-in",
    latest: async () => ({
      bytes: fs.readFileSync(path.join(out, "update-mac.json")),
      signature: fs.readFileSync(path.join(out, "update-mac.sig"), "utf8"),
    }),
    download: async (_v, archive, expect, file) => {
      downloads.push(archive)
      const bytes = fs.readFileSync(path.join(out, archive))
      if (bytes.length !== expect.size || crypto.createHash("sha256").update(bytes).digest("hex") !== expect.sha256)
        throw new UpdateError(`${archive} does not match the signed release. It was refused.`)
      fs.writeFileSync(file, bytes)
    },
  }
  return { pub, out, source, downloads }
}

function service(app: string, version: string, r: { pub: string; source: UpdateSource }, settings: Partial<UpdateSettings> = {}) {
  const audits: string[] = []
  let s: UpdateSettings = { checkEveryMinutes: 30, downloadInBackground: false, skipped: [], ...settings }
  const svc = new MacUpdateService({
    app,
    version,
    dir: path.join(root, "updates"),
    source: r.source,
    keys: [r.pub],
    arch: "arm64",
    settings: () => s,
    saveSettings: async (n) => {
      s = n
    },
    audit: async (e) => void audits.push(e),
    log: () => undefined,
    // A test app has no seal for codesign to check.
    stage: (o) => stageMacRelease({ ...o, verifySeal: async () => undefined }),
  })
  return { svc, audits, settings: () => s }
}

describe.skipIf(process.platform !== "darwin")("updating Codehouse.app in the app", () => {
  it("finds a newer Mac release, builds it beside the app, and hands over to its updater", async () => {
    const app = makeApp(path.join(root, "Applications", "Codehouse.app"), "2.0.444+mac.3")
    const r = await release("2.0.444+mac.4")
    const { svc } = service(app, "2.0.444+mac.3", r)
    const st = await svc.check()
    expect(st).toMatchObject({ available: true, canInstall: true, latest: { version: "2.0.444+mac.4" } })
    await svc.prepare("2.0.444+mac.4")
    expect(svc.status()).toMatchObject({ phase: "ready", ready: "2.0.444+mac.4" })
    // Node and the packages are unchanged, so they were cloned from the installed app, not downloaded.
    expect(r.downloads.sort()).toEqual(["codeh-mac-2.0.444-mac.4-app.zip", "codeh-mac-2.0.444-mac.4-program.zip"])
    const next = path.join(root, "updates", "mac-next", "Codehouse.app")
    expect(appVersion(next)).toBe("2.0.444+mac.4")
    const built = await macPartTrees(next)
    const expected = await macPartTrees(path.join(root, "build-2.0.444+mac.4", "Codehouse.app"))
    expect(built).toEqual(expected)
    expect(fs.readlinkSync(path.join(next, "Contents/Resources/app/node_modules/@gatehouse/policy"))).toBe("../../packages/policy")
    // The installed app is untouched.
    expect(appVersion(app)).toBe("2.0.444+mac.3")

    let handed: { updater: string; plan: string } | undefined
    svc.on("apply", (a) => (handed = a))
    await svc.apply("2.0.444+mac.4")
    const updates = path.join(root, "updates")
    expect(handed?.updater).toBe(path.join(updates, "codehouse-update.sh"))
    const plan = fs.readFileSync(handed!.plan, "utf8")
    expect(plan).toContain(`app=${app}\n`)
    expect(plan).toContain(`candidate=${next}\n`)
    expect(plan).toContain(`previous=${path.join(updates, "mac-previous", "Codehouse.app")}\n`)
    expect(plan).toContain("from=2.0.444+mac.3\nto=2.0.444+mac.4\n")
    expect(svc.status().phase).toBe("applying")
  })

  it("downloads Node again when it changed", async () => {
    const app = makeApp(path.join(root, "Applications", "Codehouse.app"), "2.0.444+mac.3")
    const r = await release("2.0.444+mac.4", { node: "node 26" })
    const { svc } = service(app, "2.0.444+mac.3", r)
    await svc.check()
    await svc.prepare("2.0.444+mac.4")
    expect(r.downloads).toContain("codeh-mac-2.0.444-mac.4-runtime.zip")
    expect(fs.readFileSync(path.join(root, "updates/mac-next/Codehouse.app/Contents/Resources/runtime/node"), "utf8")).toBe("node 26")
  })

  it("refuses a part that does not match the signed release, and keeps nothing of it", async () => {
    const app = makeApp(path.join(root, "Applications", "Codehouse.app"), "2.0.444+mac.3")
    const r = await release("2.0.444+mac.4")
    fs.appendFileSync(path.join(r.out, "codeh-mac-2.0.444-mac.4-app.zip"), "tampered")
    const { svc } = service(app, "2.0.444+mac.3", r)
    await svc.check()
    await svc.prepare("2.0.444+mac.4")
    expect(svc.status()).toMatchObject({ phase: "failed", error: /does not match the signed release/ })
    expect(fs.existsSync(path.join(root, "updates", "mac-next"))).toBe(false)
  })

  it("does not offer a release signed with another key, or one that is not newer", async () => {
    const app = makeApp(path.join(root, "Applications", "Codehouse.app"), "2.0.444+mac.4")
    const r = await release("2.0.444+mac.4")
    const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString()
    expect((await service(app, "2.0.444+mac.3", { ...r, pub: other }).svc.check()).checkError).toMatch(/Mac release key/)
    expect((await service(app, "2.0.444+mac.4", r).svc.check()).available).toBe(false)
  })

  it("says why it cannot update: not a Mac release, or opened where it was downloaded", () => {
    const r = { pub: "", source: { describe: () => "", latest: async () => undefined, download: async () => undefined } }
    const app = makeApp(path.join(root, "Applications", "Codehouse.app"), "2.0.444")
    expect(service(app, "2.0.444", r).svc.status()).toMatchObject({ canInstall: false, why: /not built as a Mac release/ })
    const moved = makeApp(path.join(root, "AppTranslocation", "X", "d", "Codehouse.app"), "2.0.444+mac.3")
    expect(service(moved, "2.0.444+mac.3", r).svc.status()).toMatchObject({ canInstall: false, why: /Move Codehouse\.app to your Applications/ })
  })

  it("does not offer again a version that would not start, and says what happened", () => {
    const app = makeApp(path.join(root, "Applications", "Codehouse.app"), "2.0.444+mac.3")
    fs.mkdirSync(path.join(root, "updates"), { recursive: true })
    fs.writeFileSync(
      path.join(root, "updates", "result.txt"),
      "ok=false\nmode=apply\nfrom=2.0.444+mac.3\nto=2.0.444+mac.4\nreason=Version 2.0.444+mac.4 did not start\n",
    )
    const r = { pub: "", source: { describe: () => "", latest: async () => undefined, download: async () => undefined } }
    const { svc, audits, settings } = service(app, "2.0.444+mac.3", r)
    expect(svc.status().lastResult).toMatchObject({ ok: false, to: "2.0.444+mac.4" })
    expect(audits).toContain("update_failed")
    return new Promise<void>((done) =>
      setTimeout(() => {
        expect(settings().skipped).toContain("2.0.444+mac.4")
        done()
      }, 50),
    )
  })

  it("writes started.json for the updater once the Host is ready", () => {
    const app = makeApp(path.join(root, "Applications", "Codehouse.app"), "2.0.444+mac.4")
    const r = { pub: "", source: { describe: () => "", latest: async () => undefined, download: async () => undefined } }
    service(app, "2.0.444+mac.4", r).svc.markStarted(42)
    expect(JSON.parse(fs.readFileSync(path.join(root, "updates", "started.json"), "utf8"))).toMatchObject({ version: "2.0.444+mac.4", pid: 42 })
  })
})
