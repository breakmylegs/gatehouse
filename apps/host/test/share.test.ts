// G40: sharing a project as a zip that leaves secrets out (by name, and by what the commit scan finds in the text),
// with a note of what was left out and never a value; and publishing with a host's own tool, as your audited action.
// The secrets here are put together at run time, so this file holds none.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { NOTE_NAME, planShare, publishCommand, secretName, ShareError, Sharing } from "../src/share.js"

const AWS = ["AK", "IA", "Q3EGRIZBPLGW5", "XYZ"].join("")
let dir: string
let repo: string
let plain: string
beforeAll(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "g40-")))
  repo = path.join(dir, "shop")
  fs.mkdirSync(path.join(repo, "src"), { recursive: true })
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, windowsHide: true })
  git("init", "--quiet")
  fs.writeFileSync(path.join(repo, ".gitignore"), "dist/\nlocal.log\n")
  fs.writeFileSync(path.join(repo, "src", "app.ts"), "export const hello = 1\n")
  fs.writeFileSync(path.join(repo, "src", "keys.ts"), `// config\nexport const k = "${AWS}"\n`)
  fs.writeFileSync(path.join(repo, ".env"), "DB_PASSWORD=hunter2hunter2\n")
  fs.writeFileSync(path.join(repo, ".env.example"), "DB_PASSWORD=\n")
  fs.writeFileSync(path.join(repo, "server.pem"), "certificate\n")
  fs.writeFileSync(path.join(repo, "local.log"), "ignored by git\n")
  fs.mkdirSync(path.join(repo, "dist"))
  fs.writeFileSync(path.join(repo, "dist", "bundle.js"), "built\n")
  // A folder that is not a repository: build and package folders are left out.
  plain = path.join(dir, "notes")
  fs.mkdirSync(path.join(plain, "node_modules", "x"), { recursive: true })
  fs.writeFileSync(path.join(plain, "readme.md"), "notes\n")
  fs.writeFileSync(path.join(plain, "node_modules", "x", "index.js"), "x\n")
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

/** The names and texts in a zip, read by its central directory. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let at = buf.readUInt32LE(end + 16)
  for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extra = buf.readUInt16LE(at + 30)
    const comment = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8")
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    out.set(name, zlib.inflateRawSync(buf.subarray(start, start + size)).toString("utf8"))
    at += 46 + nameLen + extra + comment
  }
  return out
}

function sharing(o: { killed?: boolean; recordOk?: boolean; publishers?: Array<{ name: string; command: string; args?: string[] }>; timeoutMs?: number } = {}) {
  const records: Array<Record<string, unknown>> = []
  const s = new Sharing({
    audit: { record: async (r: Record<string, unknown>) => (records.push(r), o.recordOk ?? true) } as never,
    killed: () => o.killed === true,
    policyHash: () => "h",
    publishers: () => o.publishers,
    redact: (t) => t.replace(/TOKEN-[A-Z0-9]+/g, "[redacted]"),
    env: { ...process.env, ANTHROPIC_API_KEY: "must-not-pass" },
    ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
  })
  return { s, records }
}

describe("sharing a project as a zip (G40)", () => {
  it("knows a secret file by its name, and keeps examples and templates", () => {
    expect(secretName(".env")).toBe("an environment file")
    expect(secretName("config/.env.production")).toBe("an environment file")
    expect(secretName(".env.example")).toBeUndefined()
    expect(secretName("certs/site.key")).toBe("a key or certificate")
    expect(secretName("id_ed25519")).toBe("a private key")
    expect(secretName("id_ed25519.pub")).toBeUndefined()
    expect(secretName(".npmrc")).toBe("a file of tokens or passwords")
    expect(secretName("gcp/service-account-prod.json")).toBe("a credentials file")
    expect(secretName("home/.aws/config")).toBe("a folder of credentials")
    expect(secretName("infra/terraform.tfstate")).toBe("infrastructure state with secrets")
    expect(secretName("src/keyboard.ts")).toBeUndefined()
  })

  it("takes what git would, and leaves out secrets by name and by what the text holds", async () => {
    const plan = await planShare(repo)
    expect(plan.files.sort()).toEqual([".env.example", ".gitignore", "src/app.ts"])
    expect(plan.left).toEqual(
      expect.arrayContaining([
        { file: ".env", why: "an environment file" },
        { file: "server.pem", why: "a key or certificate" },
        { file: "src/keys.ts", why: "it holds an AWS access key (line 2)" },
      ]),
    )
    expect(plan.left.map((l) => l.file)).not.toContain("dist/bundle.js")
    // Outside git: build and package folders are left out.
    expect((await planShare(plain)).files).toEqual(["readme.md"])
  })

  it("makes the zip with a note of what was left out, never a value, and records it first", async () => {
    const { s, records } = sharing()
    const { zip } = await s.zip("s1", repo)
    const files = unzip(zip)
    expect([...files.keys()].sort()).toEqual(["shop/.env.example", "shop/.gitignore", `shop/${NOTE_NAME}`, "shop/src/app.ts"])
    const note = files.get(`shop/${NOTE_NAME}`)!
    expect(note).toContain("- .env: an environment file")
    expect(note).toContain("- src/keys.ts: it holds an AWS access key (line 2)")
    const all = [...files.values()].join("\n")
    expect(all).not.toContain(AWS)
    expect(all).not.toContain("hunter2")
    expect(records).toEqual([expect.objectContaining({ event: "project_shared", channel: "desktop", input: expect.objectContaining({ files: 3 }) })])
    await expect(sharing({ recordOk: false }).s.zip("s1", repo)).rejects.toThrow(/audit log/)
  })
})

describe("publishing with a host's own tool (G40)", () => {
  const tool = () => {
    const p = path.join(dir, "fake-host.cjs")
    fs.writeFileSync(p, `require("fs").writeFileSync("published.json", JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), key: process.env.ANTHROPIC_API_KEY ?? null })); console.log("Deployed. Your site: https://shop.example TOKEN-ABC123"); if (process.argv.includes("--slow")) setTimeout(() => {}, 60000)`)
    return p
  }

  it("runs the named command in the session's folder, recorded first, without an Anthropic credential, output redacted", async () => {
    const { s, records } = sharing({ publishers: [{ name: "Fake", command: process.execPath, args: [tool(), "deploy", "--prod"] }] })
    const o = await s.publish("s1", repo, "Fake")
    expect(o).toMatchObject({ exitCode: 0, timedOut: false })
    expect(o.output).toContain("Deployed. Your site: https://shop.example [redacted]")
    const ran = JSON.parse(fs.readFileSync(path.join(repo, "published.json"), "utf8")) as { cwd: string; args: string[]; key: string | null }
    expect(path.resolve(ran.cwd)).toBe(repo)
    expect(ran.args).toEqual(["deploy", "--prod"])
    expect(ran.key).toBeNull()
    expect(records).toEqual([expect.objectContaining({ event: "project_published", channel: "desktop", input: expect.objectContaining({ host: "Fake" }) })])
    fs.rmSync(path.join(repo, "published.json"))
  })

  it("does not publish while the kill switch is engaged, unrecorded, or with a name not in Settings, and stops a slow one", async () => {
    const pubs = [{ name: "Fake", command: process.execPath, args: [tool(), "--slow"] }]
    await expect(sharing({ killed: true, publishers: pubs }).s.publish("s1", repo, "Fake")).rejects.toThrow(/kill switch/)
    await expect(sharing({ recordOk: false, publishers: pubs }).s.publish("s1", repo, "Fake")).rejects.toThrow(/audit log/)
    expect(fs.existsSync(path.join(repo, "published.json"))).toBe(false)
    await expect(sharing({ publishers: pubs }).s.publish("s1", repo, "Other")).rejects.toThrow(ShareError)
    const slow = await sharing({ publishers: pubs, timeoutMs: 500 }).s.publish("s1", repo, "Fake")
    expect(slow.timedOut).toBe(true)
    await new Promise((r) => setTimeout(r, 1500))
    fs.rmSync(path.join(repo, "published.json"), { force: true })
  })

  it("runs a .cmd tool through cmd.exe with Settings' words only, refusing a character cmd.exe treats specially", () => {
    const at = (cmd: string) => (cmd === "netlify" ? "C:\\Users\\me\\AppData\\Roaming\\npm\\netlify.cmd" : undefined)
    const c = publishCommand({ name: "Netlify", command: "netlify", args: ["deploy", "--dir", "my site", "--prod"] }, "win32", at)
    expect(c.file.toLowerCase()).toMatch(/cmd\.exe$/)
    expect(c.args).toEqual(["/d", "/s", "/c", '"C:\\Users\\me\\AppData\\Roaming\\npm\\netlify.cmd deploy --dir "my site" --prod"'])
    expect(() => publishCommand({ name: "x", command: "netlify", args: ["deploy & calc"] }, "win32", at)).toThrow(/cmd\.exe treats specially/)
    expect(() => publishCommand({ name: "x", command: "netlify", args: ["%PATH%"] }, "win32", at)).toThrow(ShareError)
    expect(publishCommand({ name: "x", command: "C:/tools/vercel.exe", args: ["deploy"] }, "win32", () => "C:/tools/vercel.exe")).toEqual({ file: "C:/tools/vercel.exe", args: ["deploy"] })
    expect(publishCommand({ name: "x", command: "vercel", args: ["--prod"] }, "darwin")).toEqual({ file: "vercel", args: ["--prod"] })
  })
})
