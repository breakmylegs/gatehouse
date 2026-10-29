// JCVC-Update.exe, compiled from packaging/Updater.cs and run for real against folders in a temporary Programs
// folder, with a stand-in JCVC.exe that starts properly, crashes or hangs as told.
import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const REPO = path.resolve(import.meta.dirname, "../../..")
const csc = [
  `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
  `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
].find((p) => fs.existsSync(p))

const STUB = `
using System; using System.IO; using System.Text.RegularExpressions; using System.Threading;
class Stub {
  static int Main(string[] args) {
    if (args.Length == 2 && args[0] == "hold") { Thread.Sleep(int.Parse(args[1])); return 0; }
    string dir = AppDomain.CurrentDomain.BaseDirectory;
    string b = Path.Combine(dir, "behaviour.txt");
    string behaviour = File.Exists(b) ? File.ReadAllText(b).Trim() : "ok";
    string version = Regex.Match(File.ReadAllText(Path.Combine(dir, "release.json")), "\\"version\\"\\\\s*:\\\\s*\\"([^\\"]+)\\"").Groups[1].Value;
    File.AppendAllText(Environment.GetEnvironmentVariable("STUB_LOG"), version + " " + behaviour + "\\n");
    if (behaviour == "crash") return 3;
    if (behaviour == "hang") { Thread.Sleep(600000); return 0; }
    File.WriteAllText(Environment.GetEnvironmentVariable("STUB_HEALTH"), "{\\"version\\":\\"" + version + "\\",\\"pid\\":1}");
    Thread.Sleep(500);
    return 0;
  }
}
`

let root: string
let updater: string
let stub: string
let n = 0

beforeAll(() => {
  if (!csc) return
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-updater-")))
  updater = path.join(root, "JCVC-Update.exe")
  stub = path.join(root, "stub.exe")
  fs.writeFileSync(path.join(root, "stub.cs"), STUB)
  execFileSync(csc, ["/nologo", "/target:exe", `/out:${stub}`, path.join(root, "stub.cs")])
  execFileSync(csc, [
    "/nologo",
    "/target:winexe",
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    `/out:${updater}`,
    path.join(REPO, "packaging", "Updater.cs"),
  ])
}, 120_000)
afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

/** One version of JCVC in a folder: the stand-in exe, its release.json and a policy folder. */
function version(
  dir: string,
  v: string,
  o: { behaviour?: string; extra?: Record<string, string> } = {},
) {
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(stub, path.join(dir, "JCVC.exe"))
  put("release.json", JSON.stringify({ version: v }))
  put("app/policy/rules.yaml", `shipped ${v}`)
  put("app/policy/library/git.yaml", `library ${v}`)
  if (o.behaviour) put("behaviour.txt", o.behaviour)
  for (const [k, t] of Object.entries(o.extra ?? {})) put(k, t)
}

function setup(mode: "apply" | "rollback", o: { timeout?: number; candidate?: string } = {}) {
  const base = path.join(root, `case${n++}`)
  const install = path.join(base, "Programs", "JCVC")
  const data = path.join(base, "data")
  fs.mkdirSync(data, { recursive: true })
  const plan = path.join(data, "plan.txt")
  const write = (from: string, to: string) =>
    fs.writeFileSync(
      plan,
      [
        `mode=${mode}`,
        `install=${install}`,
        `candidate=${o.candidate ?? (mode === "apply" ? `${install}.next` : `${install}.previous`)}`,
        `previous=${install}.previous`,
        `from=${from}`,
        `to=${to}`,
        `health=${path.join(data, "started.json")}`,
        `result=${path.join(data, "result.txt")}`,
        `timeout=${o.timeout ?? 20}`,
      ].join("\r\n"),
    )
  const run = (args: string[] = []) => {
    const r = spawnSync(updater, ["--plan", plan, "--quiet", ...args], {
      env: {
        ...process.env,
        STUB_HEALTH: path.join(data, "started.json"),
        STUB_LOG: path.join(data, "stub.log"),
      },
      timeout: 120_000,
    })
    return r.status
  }
  const read = (rel: string) => fs.readFileSync(path.join(install, rel), "utf8")
  const result = () => fs.readFileSync(path.join(data, "result.txt"), "utf8")
  const stubLog = () =>
    fs.existsSync(path.join(data, "stub.log"))
      ? fs.readFileSync(path.join(data, "stub.log"), "utf8")
      : ""
  /** What the updater said, for a failure message. */
  const said = () =>
    ["result.txt", "update.log"]
      .map((f) => path.join(data, f))
      .filter((f) => fs.existsSync(f))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join(" | ")
  return { base, install, data, write, run, read, result, stubLog, said }
}

const versionIn = (dir: string) =>
  (JSON.parse(fs.readFileSync(path.join(dir, "release.json"), "utf8")) as { version: string })
    .version

describe.skipIf(!csc)("JCVC-Update.exe", () => {
  it("switches to the new version, keeps the old one beside it, and carries your policy and the uninstaller", () => {
    const c = setup("apply")
    version(c.install, "1.0.1", {
      extra: {
        "app/policy/rules.user.yaml": "mine",
        "app/policy/projects/p.yaml": "overlay",
        "unins000.dat": "uninstaller",
      },
    })
    fs.writeFileSync(path.join(c.install, "app/policy/rules.yaml"), "my edited rules")
    version(`${c.install}.next`, "1.0.2")
    c.write("1.0.1", "1.0.2")
    expect(c.run(), c.said()).toBe(0)
    expect(versionIn(c.install)).toBe("1.0.2")
    expect(versionIn(`${c.install}.previous`)).toBe("1.0.1")
    expect(fs.existsSync(`${c.install}.next`)).toBe(false)
    expect(c.read("app/policy/rules.user.yaml")).toBe("mine")
    expect(c.read("app/policy/projects/p.yaml")).toBe("overlay")
    expect(c.read("app/policy/rules.yaml")).toBe("my edited rules")
    expect(c.read("app/policy/library/git.yaml")).toBe("library 1.0.2")
    expect(c.read("unins000.dat")).toBe("uninstaller")
    expect(c.result()).toMatch(/ok=true[\s\S]*from=1\.0\.1[\s\S]*to=1\.0\.2/)
    expect(c.stubLog()).toBe("1.0.2 ok\n")
  })

  it("goes back by itself when the new version crashes, and starts the old one", () => {
    const c = setup("apply")
    version(c.install, "1.0.1", { extra: { "app/policy/rules.user.yaml": "mine" } })
    version(`${c.install}.next`, "1.0.2", { behaviour: "crash" })
    c.write("1.0.1", "1.0.2")
    expect(c.run(), c.said()).toBe(1)
    expect(versionIn(c.install)).toBe("1.0.1")
    expect(c.read("app/policy/rules.user.yaml")).toBe("mine")
    expect(c.result()).toMatch(
      /ok=false[\s\S]*reason=It closed before it was ready \(exit code 3\)/,
    )
    expect(c.stubLog()).toBe("1.0.2 crash\n1.0.1 ok\n")
    const failed = fs
      .readdirSync(path.dirname(c.install))
      .filter((d) => d.startsWith("JCVC.failed-"))
    expect(failed).toHaveLength(1)
  })

  it("stops a new version that never says it is ready, and goes back", () => {
    const c = setup("apply", { timeout: 4 })
    version(c.install, "1.0.1")
    version(`${c.install}.next`, "1.0.2", { behaviour: "hang" })
    c.write("1.0.1", "1.0.2")
    expect(c.run(), c.said()).toBe(1)
    expect(versionIn(c.install)).toBe("1.0.1")
    expect(c.result()).toMatch(/did not say it was ready within 4 seconds/)
    // Under load the new version may be stopped before it even starts; either way the old one is started again.
    expect(c.stubLog()).toMatch(/^(1\.0\.2 hang\n)?1\.0\.1 ok\n$/)
  })

  it("goes back to the kept version, and keeps the newer one beside it", () => {
    const c = setup("rollback")
    version(c.install, "1.0.2", { extra: { "app/policy/rules.user.yaml": "changed since" } })
    version(`${c.install}.previous`, "1.0.1")
    c.write("1.0.2", "1.0.1")
    expect(c.run(), c.said()).toBe(0)
    expect(versionIn(c.install)).toBe("1.0.1")
    expect(versionIn(`${c.install}.previous`)).toBe("1.0.2")
    expect(c.read("app/policy/rules.user.yaml")).toBe("changed since")
    expect(c.result()).toMatch(/ok=true[\s\S]*mode=rollback/)
  })

  it("waits while another program still has the folder open, then switches", async () => {
    const c = setup("apply")
    version(c.install, "1.0.1")
    version(`${c.install}.next`, "1.0.2")
    fs.copyFileSync(stub, path.join(c.install, "holder.exe"))
    const holder = spawn(path.join(c.install, "holder.exe"), ["hold", "3000"])
    await new Promise((r) => setTimeout(r, 300))
    c.write("1.0.1", "1.0.2")
    const started = Date.now()
    expect(c.run(), c.said()).toBe(0)
    expect(Date.now() - started).toBeGreaterThan(2000)
    expect(versionIn(c.install)).toBe("1.0.2")
    holder.kill()
  })

  it("refuses a plan that names a folder not beside the install folder, and moves nothing", () => {
    const elsewhere = path.join(root, `elsewhere${n}`)
    const c = setup("apply", { candidate: elsewhere })
    version(c.install, "1.0.1")
    version(elsewhere, "6.6.6")
    c.write("1.0.1", "6.6.6")
    expect(c.run(), c.said()).toBe(1)
    expect(versionIn(c.install)).toBe("1.0.1")
    expect(versionIn(elsewhere)).toBe("6.6.6")
    expect(c.result()).toMatch(/not beside/)
    // JCVC had closed, so the version in place is started again.
    expect(c.stubLog()).toBe("1.0.1 ok\n")
  })
})
