import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { verifyRelease, MANIFEST_FORMAT, signRelease } from "../src/update/manifest.js"
import { makeRelease, newReleaseKey, stampInstall } from "../src/update/publish.js"
import { UpdateService, parseResult, type UpdateSettings } from "../src/update/service.js"
import { GitHubSource, UpdateError } from "../src/update/source.js"
import { readInstalled, stageRelease } from "../src/update/stage.js"
import { extractZip, writeZip } from "../src/update/zip.js"
import { listFiles, partOf, partTrees, treeHash } from "../src/update/tree.js"
import { compareVersions, isNewer, parseVersion } from "../src/update/version.js"

const key = newReleaseKey()
const other = newReleaseKey()
let root: string

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-update-")))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

/** A packaged JCVC folder in miniature: the three parts, with the variant in the files that change. */
function makeBuild(dir: string, v: { app: string; modules?: string; runtime?: string }): string {
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  fs.rmSync(dir, { recursive: true, force: true })
  put("JCVC.exe", `window ${v.app}`)
  put("JCVC-Update.exe", `updater ${v.app}`)
  put("README.txt", "readme")
  put("app/apps/host/src/main.ts", `main ${v.app}`)
  put("app/policy/rules.yaml", "rules: shipped")
  put("app/policy/library/git.yaml", `library ${v.app}`)
  put("app/node_modules/pkg/index.js", `module ${v.modules ?? "m1"}`)
  put("app/node_modules/pkg/package.json", "{}")
  put("runtime/node.exe", `node ${v.runtime ?? "r1"}`)
  return dir
}

describe("versions", () => {
  it("orders releases by number, puts a -dev build before its release, and ignores +build", () => {
    expect(compareVersions("1.0.80", "1.0.79")).toBeGreaterThan(0)
    expect(compareVersions("1.0.100", "1.0.99")).toBeGreaterThan(0)
    expect(compareVersions("1.1.0", "1.0.999")).toBeGreaterThan(0)
    expect(isNewer("1.0.80", "1.0.80-dev")).toBe(true)
    expect(isNewer("1.0.80-dev", "1.0.80")).toBe(false)
    expect(compareVersions("1.0.80+local", "1.0.80")).toBe(0)
    expect(parseVersion("1.0")).toBeUndefined()
    expect(parseVersion("1.0.80; rm -rf")).toBeUndefined()
    expect(() => compareVersions("x", "1.0.0")).toThrow()
  })
})

describe("part hashes", () => {
  it("puts each file in one part and leaves the release files out", () => {
    expect(partOf("runtime/node.exe")).toBe("runtime")
    expect(partOf("app/node_modules/a/b.js")).toBe("modules")
    expect(partOf("app/apps/host/src/main.ts")).toBe("app")
    expect(partOf("JCVC.exe")).toBe("app")
    expect(partOf("release.json")).toBeUndefined()
    expect(partOf(".jcvc-staged")).toBeUndefined()
  })

  it("changes with a file's content or name, not with listing order", async () => {
    const d = makeBuild(path.join(root, "hash"), { app: "a" })
    const files = await listFiles(d)
    const h = await treeHash(d, files)
    expect(await treeHash(d, [...files].reverse())).toBe(h)
    fs.writeFileSync(path.join(d, "README.txt"), "readme!")
    expect(await treeHash(d, files)).not.toBe(h)
    const t = await partTrees(d)
    expect(t.modules.files).toBe(2)
    expect(t.runtime.files).toBe(1)
    expect(t.app.files).toBe(6)
  })
})

describe("signed release descriptions", () => {
  const manifest = (extra: Record<string, unknown> = {}) =>
    Buffer.from(
      JSON.stringify({
        format: MANIFEST_FORMAT,
        product: "jcvc",
        version: "1.0.5",
        notes: "n",
        parts: ["app", "modules", "runtime"].map((name) => ({
          name,
          tree: "a".repeat(64),
          files: 1,
          bytes: 1,
          archive: `jcvc-1.0.5-${name}.zip`,
          size: 10,
          sha256: "b".repeat(64),
        })),
        ...extra,
      }),
    )

  it("trusts only the release key, and only the exact bytes it signed", () => {
    const bytes = manifest()
    expect(verifyRelease(bytes, signRelease(bytes, key.privatePem), [key.publicPem]).ok).toBe(true)
    expect(verifyRelease(bytes, signRelease(bytes, other.privatePem), [key.publicPem]).ok).toBe(
      false,
    )
    const tampered = Buffer.from(bytes.toString().replace("1.0.5", "1.0.6"))
    const r = verifyRelease(tampered, signRelease(bytes, key.privatePem), [key.publicPem])
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/not signed/) })
    expect(verifyRelease(bytes, "not base64 at all", [key.publicPem]).ok).toBe(false)
  })

  it("sends a release with a newer layout to the installer, and refuses one without downloads", () => {
    const newer = manifest({ format: MANIFEST_FORMAT + 1 })
    expect(verifyRelease(newer, signRelease(newer, key.privatePem), [key.publicPem])).toMatchObject(
      {
        ok: false,
        error: expect.stringMatching(/needs the installer/),
      },
    )
    const bare = Buffer.from(
      manifest()
        .toString()
        .replace(/"archive":"[^"]+",/g, ""),
    )
    expect(verifyRelease(bare, signRelease(bare, key.privatePem), [key.publicPem]).ok).toBe(false)
  })
})

/** A stand-in for github.com and its download host, on two local ports. */
interface FakeGitHub {
  base: string
  blob: string
  latest: string | undefined
  releases: Map<string, string>
  seen: Array<{ url: string; auth?: string }>
  tamper: Set<string>
  redirectAway: boolean
  close(): Promise<void>
}

async function fakeGitHub(token = "ghp_" + "t".repeat(36)): Promise<FakeGitHub> {
  const state = {
    latest: undefined as string | undefined,
    releases: new Map<string, string>(),
    seen: [] as Array<{ url: string; auth?: string }>,
    tamper: new Set<string>(),
    redirectAway: false,
  }
  const serveFile = (res: http.ServerResponse, ver: string, file: string) => {
    const dir = state.releases.get(ver)
    const p = dir && path.join(dir, file)
    if (!p || !fs.existsSync(p)) return void res.writeHead(404).end()
    let body = fs.readFileSync(p)
    if (state.tamper.has(file))
      body = Buffer.concat([
        body.subarray(0, body.length - 1),
        Buffer.from([body[body.length - 1]! ^ 1]),
      ])
    res.writeHead(200, { "content-length": body.length }).end(body)
  }
  const blobServer = http.createServer((req, res) => {
    state.seen.push({
      url: `blob:${req.url}`,
      ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
    })
    const m = /^\/blob\/v([^/]+)\/([^/]+)$/.exec(req.url ?? "")
    if (!m) return void res.writeHead(404).end()
    serveFile(res, m[1]!, m[2]!)
  })
  await new Promise<void>((r) => blobServer.listen(0, "127.0.0.1", () => r()))
  const blob = `http://127.0.0.1:${(blobServer.address() as AddressInfo).port}`
  const server = http.createServer((req, res) => {
    const url = req.url ?? ""
    state.seen.push({
      url,
      ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
    })
    let m = /^\/o\/r\/releases\/latest\/download\/([^/]+)$/.exec(url)
    if (m) {
      if (!state.latest) return void res.writeHead(404).end()
      return void res
        .writeHead(302, { location: `/o/r/releases/download/v${state.latest}/${m[1]}` })
        .end()
    }
    m = /^\/o\/r\/releases\/download\/v([^/]+)\/([^/]+)$/.exec(url)
    if (m) {
      const to = state.redirectAway ? "https://example.com/x" : `${blob}/blob/v${m[1]}/${m[2]}`
      return void res.writeHead(302, { location: to }).end()
    }
    const authed = req.headers.authorization === `Bearer ${token}`
    if (url === "/api/repos/o/r/releases/latest") {
      if (!authed || !state.latest) return void res.writeHead(404).end()
      const dir = state.releases.get(state.latest) as string
      const assets = fs.readdirSync(dir).map((name) => ({
        name,
        url: `${base}/api/repos/o/r/releases/assets/${state.latest}/${name}`,
      }))
      return void res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ tag_name: `v${state.latest}`, assets }))
    }
    m = /^\/api\/repos\/o\/r\/releases\/assets\/([^/]+)\/([^/]+)$/.exec(url)
    if (m) {
      if (!authed) return void res.writeHead(404).end()
      return void res.writeHead(302, { location: `${blob}/blob/v${m[1]}/${m[2]}` }).end()
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const gh = Object.assign(state, {
    base,
    blob,
    close: async () => {
      await new Promise((r) => server.close(r))
      await new Promise((r) => blobServer.close(r))
    },
  })
  return gh as FakeGitHub
}

async function publish(
  gh: FakeGitHub,
  version: string,
  v: { app: string; modules?: string; runtime?: string },
) {
  const dir = makeBuild(path.join(root, `build-${version}`), v)
  const out = path.join(root, `out-${version}`)
  fs.rmSync(out, { recursive: true, force: true })
  const made = await makeRelease({
    dir,
    out,
    version,
    notes: `What is new in ${version}`,
    privateKeyPem: key.privatePem,
  })
  gh.releases.set(version, out)
  gh.latest = version
  return made
}

describe("fetching and staging a release", () => {
  let gh: FakeGitHub
  beforeAll(async () => {
    gh = await fakeGitHub()
  })
  afterAll(async () => gh.close())
  beforeEach(() => {
    gh.seen.length = 0
    gh.tamper.clear()
    gh.redirectAway = false
  })
  const source = (o: { token?: string } = {}) =>
    new GitHubSource({
      repo: "o/r",
      base: gh.base,
      testOrigins: [gh.blob],
      ...(o.token ? { token: () => o.token } : {}),
    })

  it("says there is nothing yet when the repository has no release", async () => {
    gh.latest = undefined
    expect(await source().latest()).toBeUndefined()
  })

  it("reads the newest release and its signature from the same release", async () => {
    await publish(gh, "1.0.2", { app: "a2" })
    const got = await source().latest()
    expect(got).toBeDefined()
    expect(verifyRelease(got!.bytes, got!.signature, [key.publicPem])).toMatchObject({
      ok: true,
      manifest: { version: "1.0.2" },
    })
    expect(gh.seen.map((s) => s.url)).toContain("/o/r/releases/download/v1.0.2/release.sig")
  })

  it("refuses a redirect that leaves GitHub", async () => {
    gh.redirectAway = true
    await expect(source().latest()).rejects.toThrow(/Refused to fetch from https:\/\/example.com/)
  })

  it("with a token, uses the API and never sends the token to the download host", async () => {
    const token = "ghp_" + "t".repeat(36)
    const got = await source({ token }).latest()
    expect(got).toBeDefined()
    const api = gh.seen.filter((s) => s.url.startsWith("/api/"))
    const blobs = gh.seen.filter((s) => s.url.startsWith("blob:"))
    expect(api.length).toBeGreaterThan(0)
    expect(api.every((s) => s.auth === `Bearer ${token}`)).toBe(true)
    expect(blobs.length).toBeGreaterThan(0)
    expect(blobs.some((s) => s.auth)).toBe(false)
  })

  it("refuses an archive whose bytes are not the ones signed, and leaves nothing behind", async () => {
    const made = await publish(gh, "1.0.3", { app: "a3" })
    const app = made.manifest.parts.find((p) => p.name === "app")!
    gh.tamper.add(app.archive!)
    const file = path.join(root, "dl-tampered.zip")
    await expect(
      source().download(
        "1.0.3",
        app.archive!,
        { size: app.size!, sha256: app.sha256! },
        file,
        () => undefined,
      ),
    ).rejects.toThrow(/does not match the signed release/)
    expect(fs.existsSync(file) || fs.existsSync(`${file}.part`)).toBe(false)
  })

  it("builds the new version beside the old one, downloading only the parts that changed", async () => {
    const installDir = makeBuild(path.join(root, "inst", "JCVC"), { app: "a1" })
    await stampInstall(installDir, { version: "1.0.1" })
    const made = await publish(gh, "1.0.4", { app: "a4" })
    const got = await source().latest()
    const stagedDir = `${installDir}.next`
    const downloads: string[] = []
    const src = source()
    const spy = {
      ...src,
      describe: () => src.describe(),
      latest: () => src.latest(),
      download: (...a: Parameters<typeof src.download>) => (
        downloads.push(a[1]),
        src.download(...a)
      ),
    }
    await stageRelease({
      manifest: made.manifest,
      manifestBytes: got!.bytes,
      signature: got!.signature,
      installDir,
      stagedDir,
      downloadsDir: path.join(root, "downloads"),
      installed: readInstalled(installDir),
      source: spy,
    })
    expect(downloads).toEqual(["jcvc-1.0.4-app.zip"])
    const trees = await partTrees(stagedDir)
    for (const p of made.manifest.parts) expect(trees[p.name].tree, p.name).toBe(p.tree)
    expect(fs.readFileSync(path.join(stagedDir, "app/apps/host/src/main.ts"), "utf8")).toBe(
      "main a4",
    )
    expect(fs.readFileSync(path.join(stagedDir, "release.json"))).toEqual(got!.bytes)
    expect(fs.readFileSync(path.join(stagedDir, ".jcvc-staged"), "utf8")).toBe("1.0.4")
    // The running version is untouched.
    expect(fs.readFileSync(path.join(installDir, "app/apps/host/src/main.ts"), "utf8")).toBe(
      "main a1",
    )
  })

  it("downloads a part again when the copy on disk no longer matches its hash", async () => {
    const installDir = makeBuild(path.join(root, "inst2", "JCVC"), { app: "a1" })
    await stampInstall(installDir, { version: "1.0.1" })
    fs.writeFileSync(path.join(installDir, "app/node_modules/pkg/index.js"), "changed on disk")
    const made = await publish(gh, "1.0.5", { app: "a5" })
    const got = await source().latest()
    const downloads: string[] = []
    const src = source()
    await stageRelease({
      manifest: made.manifest,
      manifestBytes: got!.bytes,
      signature: got!.signature,
      installDir,
      stagedDir: `${installDir}.next`,
      downloadsDir: path.join(root, "downloads2"),
      installed: readInstalled(installDir),
      source: {
        describe: () => "",
        latest: () => src.latest(),
        download: (...a) => (downloads.push(a[1]), src.download(...a)),
      },
    })
    expect(downloads.sort()).toEqual(["jcvc-1.0.5-app.zip", "jcvc-1.0.5-modules.zip"])
    expect(
      fs.readFileSync(path.join(`${installDir}.next`, "app/node_modules/pkg/index.js"), "utf8"),
    ).toBe("module m1")
  })

  it("refuses an archive that would write outside its part or outside the folder", async () => {
    const zip = (name: string, entries: string[]) => {
      const out = path.join(root, name)
      fs.writeFileSync(out, rawZip(entries.map((e) => ({ name: e, data: Buffer.from("x") }))))
      return out
    }
    const dest = path.join(root, "unpack-bad", "JCVC.next")
    for (const bad of [
      "../escape.txt",
      "app/../../escape.txt",
      "C:/escape.txt",
      ["app", "..", "x.txt"].join(String.fromCharCode(92)),
      "release.json",
    ]) {
      await expect(
        extractZip(zip("bad.zip", ["README.txt", bad]), dest, "app", { files: 9, bytes: 99 }),
        bad,
      ).rejects.toThrow(/may not write/)
      expect(fs.existsSync(dest), "nothing is written when any name is refused").toBe(false)
    }
    await expect(
      extractZip(zip("wrong-part.zip", ["app/apps/host/src/main.ts"]), dest, "modules", {
        files: 9,
        bytes: 99,
      }),
    ).rejects.toThrow(/may not write/)
    expect(
      await extractZip(
        zip("fine.zip", ["app/node_modules/pkg/index.js", "app/node_modules/pkg/package.json"]),
        dest,
        "modules",
        { files: 2, bytes: 2 },
      ),
    ).toBe(2)
  })

  it("refuses an archive that holds more files or bytes than the signed release says", async () => {
    const out = path.join(root, "bomb.zip")
    fs.writeFileSync(
      out,
      rawZip([
        { name: "app/a.txt", data: Buffer.alloc(5000) },
        { name: "app/b.txt", data: Buffer.from("b") },
      ]),
    )
    const dest = path.join(root, "unpack-bomb")
    await expect(extractZip(out, dest, "app", { files: 1, bytes: 10_000 })).rejects.toThrow(
      /more than the signed release/,
    )
    await expect(extractZip(out, dest, "app", { files: 2, bytes: 100 })).rejects.toThrow(
      /more than the signed release/,
    )
    expect(fs.existsSync(dest)).toBe(false)
  })

  it("keeps file names in any script, with spaces and brackets, exactly, through a zip", async () => {
    const src = path.join(root, "names")
    const names = [
      "app/snow ☃/index.html",
      "app/[...]/a .md",
      "app/日本語/файл.txt",
      "app/plain.txt",
    ]
    for (const n of names) {
      fs.mkdirSync(path.dirname(path.join(src, n)), { recursive: true })
      fs.writeFileSync(path.join(src, n), n)
    }
    const rels = await listFiles(src)
    const zip = path.join(root, "names.zip")
    await writeZip(zip, src, rels)
    const dest = path.join(root, "names-out")
    expect(await extractZip(zip, dest, "app", { files: 4, bytes: 1000 })).toBe(4)
    expect(await listFiles(dest)).toEqual(rels)
    expect(await treeHash(dest, rels)).toBe(await treeHash(src, rels))
  })

  it("never follows a link while listing a folder", async () => {
    const d = path.join(root, "links")
    fs.mkdirSync(path.join(d, "app", "real"), { recursive: true })
    fs.writeFileSync(path.join(d, "app", "real", "f.txt"), "f")
    fs.mkdirSync(path.join(d, "app", "node_modules", "@gatehouse"), { recursive: true })
    fs.symlinkSync(
      path.join(d, "app", "real"),
      path.join(d, "app", "node_modules", "@gatehouse", "x"),
      "junction",
    )
    expect(await listFiles(d)).toEqual(["app/real/f.txt"])
  })
})

describe("the update service", () => {
  let gh: FakeGitHub
  let n = 0
  beforeAll(async () => {
    gh = await fakeGitHub()
  })
  afterAll(async () => gh.close())

  function service(o: { installed?: string | false; settings?: Partial<UpdateSettings> } = {}) {
    const base = path.join(root, `svc${n++}`)
    const installDir = path.join(base, "Programs", "JCVC")
    if (o.installed !== false) makeBuild(installDir, { app: "a1" })
    let settings: UpdateSettings = {
      checkEveryMinutes: 30,
      downloadInBackground: false,
      skipped: [],
      ...o.settings,
    }
    const audited: Array<{ event: string; input: Record<string, unknown> }> = []
    const make = async () => {
      if (o.installed !== false) await stampInstall(installDir, { version: o.installed ?? "1.0.1" })
      const svc = new UpdateService({
        installDir: o.installed === false ? undefined : installDir,
        sourceVersion: "1.0.0-source",
        dir: path.join(base, "data", "updates"),
        source: new GitHubSource({ repo: "o/r", base: gh.base, testOrigins: [gh.blob] }),
        keys: [key.publicPem],
        settings: () => settings,
        saveSettings: async (s) => {
          settings = s
        },
        audit: async (event, input) => {
          audited.push({ event, input })
        },
        log: () => undefined,
        firstCheckDelayMs: 3_600_000,
      })
      return svc
    }
    return {
      make,
      installDir,
      dir: path.join(base, "data", "updates"),
      audited,
      settings: () => settings,
    }
  }

  it("finds a newer release, offers it, and stops offering it once skipped", async () => {
    await publish(gh, "1.0.6", { app: "a6" })
    const s = service()
    const svc = await s.make()
    const st = await svc.check()
    expect(st).toMatchObject({
      current: "1.0.1",
      kind: "release",
      canInstall: true,
      available: true,
      latest: { version: "1.0.6", notes: "What is new in 1.0.6" },
    })
    expect((await svc.skip("1.0.6")).available).toBe(false)
    expect(s.settings().skipped).toEqual(["1.0.6"])
    expect(s.audited.map((a) => a.event)).toContain("update_skipped")
    expect((await svc.unskip("1.0.6")).available).toBe(true)
  })

  it("never offers an older or equal version, and reports a failed check without throwing", async () => {
    const s = service({ installed: "1.0.6" })
    const svc = await s.make()
    expect((await svc.check()).available).toBe(false)
    gh.redirectAway = true
    const st = await svc.check()
    gh.redirectAway = false
    expect(st.checkError).toMatch(/Refused to fetch/)
    expect(st.available).toBe(false)
  })

  it("from the source folder it can look but not install", async () => {
    const svc = await service({ installed: false }).make()
    const st = await svc.check()
    expect(st).toMatchObject({ kind: "source", canInstall: false, current: "1.0.0-source" })
    await expect(svc.prepare("1.0.6")).rejects.toThrow(/source folder/)
  })

  it("prepares in the background when allowed, then hands over to JCVC-Update.exe with a plan", async () => {
    const s = service({ settings: { downloadInBackground: true } })
    const svc = await s.make()
    const ready = new Promise<void>((r) => svc.on("status", (st) => st.phase === "ready" && r()))
    await svc.check()
    await ready
    expect(svc.status()).toMatchObject({ phase: "ready", ready: "1.0.6" })
    await expect(svc.apply("1.0.5")).rejects.toThrow(/not ready/)
    const handed = new Promise<{ updater: string; plan: string }>((r) => svc.once("apply", r))
    await svc.apply("1.0.6")
    const { updater, plan } = await handed
    expect(fs.readFileSync(updater, "utf8")).toBe("updater a6")
    const text = fs.readFileSync(plan, "utf8")
    expect(text).toContain("mode=apply")
    expect(text).toContain(`install=${s.installDir}`)
    expect(text).toContain(`candidate=${s.installDir}.next`)
    expect(text).toContain(`previous=${s.installDir}.previous`)
    expect(text).toContain("from=1.0.1")
    expect(text).toContain("to=1.0.6")
    expect(svc.status().phase).toBe("applying")
    expect(s.audited.map((a) => a.event)).toEqual(
      expect.arrayContaining(["update_downloaded", "update_started"]),
    )
  })

  it("goes back to the kept version, and skips the one it leaves", async () => {
    const s = service({ installed: "1.0.6" })
    makeBuild(`${s.installDir}.previous`, { app: "a1" })
    await stampInstall(`${s.installDir}.previous`, { version: "1.0.1" })
    const svc = await s.make()
    expect(svc.status().previous).toBe("1.0.1")
    const handed = new Promise<{ plan: string }>((r) => svc.once("apply", r))
    await svc.rollback()
    const text = fs.readFileSync((await handed).plan, "utf8")
    expect(text).toContain("mode=rollback")
    expect(text).toContain("to=1.0.1")
    expect(s.settings().skipped).toContain("1.0.6")
  })

  it("reads what JCVC-Update.exe reported, and skips a version that would not start", async () => {
    const s = service({ installed: "1.0.1" })
    fs.mkdirSync(s.dir, { recursive: true })
    fs.writeFileSync(
      path.join(s.dir, "result.txt"),
      "ok=false\r\nmode=apply\r\nfrom=1.0.1\r\nto=1.0.6\r\nreason=It did not start within 240 seconds.\r\n",
    )
    const svc = await s.make()
    await new Promise((r) => setTimeout(r, 20))
    expect(svc.status().lastResult).toMatchObject({
      ok: false,
      to: "1.0.6",
      reason: expect.stringMatching(/did not start/),
    })
    expect(s.settings().skipped).toContain("1.0.6")
    expect(s.audited.map((a) => a.event)).toContain("update_failed")
    expect(fs.existsSync(path.join(s.dir, "result.txt"))).toBe(false)
    expect(svc.dismissResult().lastResult).toBeUndefined()
  })

  it("checks on the chosen interval, or never", async () => {
    const s = service()
    const svc = await s.make()
    svc.start()
    expect(svc.status().nextCheck).toBeDefined()
    await svc.setSettings({ checkEveryMinutes: 0 })
    expect(svc.status().nextCheck).toBeUndefined()
    await svc.setSettings({ checkEveryMinutes: 15 })
    const next = Date.parse(svc.status().nextCheck as string)
    expect(next - Date.now()).toBeGreaterThan(14 * 60_000)
    await expect(svc.setSettings({ checkEveryMinutes: 7 })).rejects.toBeInstanceOf(UpdateError)
    svc.stop()
  })

  it("says it started, so JCVC-Update.exe knows the new version works", async () => {
    const s = service({ installed: "1.0.6" })
    const svc = await s.make()
    svc.markStarted(1234)
    expect(JSON.parse(fs.readFileSync(path.join(s.dir, "started.json"), "utf8"))).toMatchObject({
      version: "1.0.6",
      pid: 1234,
    })
  })
})

describe("the result file", () => {
  it("reads key=value lines and ignores anything else", () => {
    expect(parseResult("ok=true\nmode=apply\nfrom=1.0.1\nto=1.0.2\nnoise\n")).toEqual({
      ok: true,
      mode: "apply",
      from: "1.0.1",
      to: "1.0.2",
    })
    expect(parseResult("").ok).toBe(false)
  })
})

/** A zip written byte by byte (stored, no compression), so a test can hold names no zip tool would write. */
function rawZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8")
    const crc = zlib.crc32(e.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(e.data.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, e.data)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(e.data.length, 20)
    c.writeUInt32LE(e.data.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, name)
    offset += 30 + name.length + e.data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}
