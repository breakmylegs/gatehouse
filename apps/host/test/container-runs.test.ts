// E-026: a heavy check runs in a container with no network and the project read-only when Podman is here and Settings
// allow it; without Podman the feature says it is unavailable and nothing changes.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runCodehouseAction, type ActionDeps } from "../src/codehouse-action.js"
import { containerCheck, containerFor, DEFAULT_IMAGE, findPodman } from "../src/container-runs.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function standIn() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-podman-"))
  dirs.push(dir)
  const script = path.join(dir, "podman.cjs")
  const said = path.join(dir, "argv.json")
  fs.writeFileSync(script, `require("fs").writeFileSync(${JSON.stringify(said)}, JSON.stringify(process.argv.slice(2))); console.log("in the box")`)
  return { dir, script, said }
}

const deps = (outcome: "allow" | "deny", container: ActionDeps["container"]): ActionDeps => ({
  approver: { evaluate: async () => ({ outcome, ruleId: outcome === "allow" ? "safe-shell" : "destructive-shell", reason: "r", risk: 10, decidedBy: "rules", policyHash: "h" }) },
  broker: { request: async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1, at: "" }) } as never,
  audit: { record: async () => true },
  kill: { isEngaged: () => false },
  extreme: () => false,
  env: { PATH: process.env.PATH ?? "" },
  container,
})

describe("container runs", () => {
  it("runs the check through Podman with no network, the project read-only and a scratch volume", { timeout: 30_000 }, async () => {
    const p = standIn()
    const scratch = path.join(p.dir, "scratch")
    const r = await runCodehouseAction(
      { sessionId: "s1", cwd: p.dir, project: "p", command: "npm test", why: "a check", level: "high" },
      deps("allow", () => ({ exe: process.execPath, prefix: [p.script], image: "node:22-alpine", scratch })),
    )
    expect(r).toMatchObject({ ran: true, exitCode: 0 })
    expect(r.output).toContain("in the box")
    const argv = JSON.parse(fs.readFileSync(p.said, "utf8")) as string[]
    expect(argv.slice(0, 2)).toEqual(["run", "--rm"])
    expect(argv).toContain("--network=none")
    expect(argv).toContain(`${p.dir}:/work:ro`)
    expect(argv).toContain(`${scratch}:/scratch`)
    expect(argv.slice(-4)).toEqual(["node:22-alpine", "sh", "-c", "npm test"])
    expect(fs.existsSync(scratch)).toBe(true)
  })

  it("still refuses what the rules deny, before any container starts", async () => {
    const p = standIn()
    const r = await runCodehouseAction(
      { sessionId: "s1", cwd: p.dir, project: "p", command: "rm -rf /", why: "a check", level: "high" },
      deps("deny", () => ({ exe: process.execPath, prefix: [p.script], image: "i", scratch: path.join(p.dir, "s") })),
    )
    expect(r.ran).toBe(false)
    expect(fs.existsSync(p.said)).toBe(false)
  })

  it("is used only when switched on and Podman is here, with a safe image name", () => {
    expect(containerFor(undefined, "C:/bin/podman.exe", "D", "s1")).toBeUndefined()
    expect(containerFor({ enabled: true }, undefined, "D", "s1")).toBeUndefined()
    expect(containerFor({ enabled: true }, "C:/bin/podman.exe", "D", "s1")).toMatchObject({ exe: "C:/bin/podman.exe", image: DEFAULT_IMAGE })
    expect(containerFor({ enabled: true, image: "--privileged" }, "podman", "D", "s1")?.image).toBe(DEFAULT_IMAGE)
    expect(containerFor({ enabled: true, image: "ghcr.io/me/ci:1" }, "podman", "D", "../x")?.scratch).toBe(path.join("D", "container-scratch", "___x"))
  })

  it("says it is unavailable without Podman", () => {
    expect(findPodman({ PATH: "C:\\none" }, "win32", () => false)).toBeUndefined()
    expect(findPodman({ PATH: "C:\\pm" }, "win32", (f) => f.toLowerCase() === "c:\\pm\\podman.exe")).toBe("C:\\pm\\podman.exe")
    expect(containerCheck({ enabled: true }, undefined)).toMatchObject({ state: "warn", detail: expect.stringMatching(/^Unavailable: Podman is not on this computer/) })
    expect(containerCheck(undefined, undefined).detail).toMatch(/^Unavailable/)
    expect(containerCheck({ enabled: true }, "podman")).toMatchObject({ state: "ok", detail: expect.stringMatching(/no network/) })
  })
})
