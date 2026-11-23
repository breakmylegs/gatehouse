// E-098: the upgrade rehearsal: the new version, against a synthetic copy of settings and policy, passes or fails by
// its own steps; a policy that does not load fails it; the real data folder is untouched, and the copy holds settings
// and policy only and is deleted.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { rehearse, syntheticDataDir, type RealPaths, type Runner } from "../src/rehearsal.js"
import { runRehearsal, REHEARSAL_MARK } from "../src/rehearse-run.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = (p: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), p))
  dirs.push(d)
  return d
}

/** A data folder as Codehouse keeps one, with what must never be copied in it too. */
function realFolder(localRules = "version: 1\nremember: []\n"): { root: string; paths: RealPaths } {
  const root = tmp("codeh-real-")
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  put("config.json", JSON.stringify({ redactTerms: ["ACME"] }))
  put("rules/rules.local.yaml", localRules)
  put("rules/projects/shop.yaml", "version: 1\n")
  put("rule-packs/README.txt", "not a pack")
  put("audit/2026-11.jsonl", '{"seq":1}\n')
  put("open-sessions.json", JSON.stringify({ sessions: [{ id: "real-session" }] }))
  put("knowledge-key.json", "secret")
  return { root, paths: { configFile: path.join(root, "config.json"), localRules: path.join(root, "rules", "rules.local.yaml"), userRules: path.join(root, "rules", "rules.user.yaml"), overlayDir: path.join(root, "rules", "projects"), packsDir: path.join(root, "rule-packs") } }
}

const hashTree = (dir: string): string => {
  const h = crypto.createHash("sha256")
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n)
      const st = fs.statSync(p)
      h.update(`${path.relative(dir, p)}:${st.mtimeMs}:${st.size}\n`)
      if (st.isDirectory()) walk(p)
      else h.update(fs.readFileSync(p))
    }
  }
  walk(dir)
  return h.digest("hex")
}

/** The staged release, in this test: the rehearsal run in this process, with the environment it would get. */
const inProcess: Runner = async (_node, _args, env) => {
  const r = await runRehearsal(env)
  return { stdout: `started\n${JSON.stringify({ [REHEARSAL_MARK]: 1, ...r })}\n`, code: r.ok ? 0 : 1 }
}
function staged() {
  const s = tmp("codeh-staged-")
  fs.mkdirSync(path.join(s, "app", "apps", "host", "dist"), { recursive: true })
  fs.writeFileSync(path.join(s, "app", "apps", "host", "dist", "main.mjs"), "")
  fs.mkdirSync(path.join(s, "runtime"))
  fs.writeFileSync(path.join(s, "runtime", "node.exe"), "")
  return s
}

describe("the upgrade rehearsal", () => {
  it("passes a version that reads the settings, loads the policy, passes its canaries and can restore sessions", { timeout: 120_000 }, async () => {
    const real = realFolder()
    const r = await rehearse(staged(), real.paths, { run: inProcess })
    expect(r.steps.map((s) => [s.name, s.ok])).toEqual([
      ["settings", true],
      ["policy", true],
      ["canaries", true],
      ["restore", true],
    ])
    expect(r.state).toBe("passed")
  })

  it("fails a version whose policy does not load, saying why", { timeout: 120_000 }, async () => {
    const real = realFolder("remember: [ {\n")
    const r = await rehearse(staged(), real.paths, { run: inProcess })
    expect(r.state).toBe("failed")
    expect(r.why).toMatch(/^policy: /)
    expect(r.steps.find((s) => s.name === "canaries")).toMatchObject({ ok: false, detail: "not run: the policy did not load" })
  })

  it("leaves the real data folder untouched, copies only settings and policy, and deletes the copy", { timeout: 120_000 }, async () => {
    const real = realFolder()
    const before = hashTree(real.root)
    const tmpRoot = tmp("codeh-reh-root-")
    let seen: string[] = []
    const run: Runner = async (node, args, env) => {
      const dir = env.GATEHOUSE_DATA_DIR as string
      seen = fs.readdirSync(dir, { recursive: true }).map((x) => String(x).replace(/\\/g, "/")).sort()
      // Every path the new version is given is inside the copy.
      for (const k of ["GATEHOUSE_CONFIG", "GATEHOUSE_LOCAL_RULES", "GATEHOUSE_USER_RULES", "GATEHOUSE_OVERLAY_DIR"]) expect(path.relative(dir, env[k] as string).startsWith("..")).toBe(false)
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      return inProcess(node, args, env, 1000)
    }
    process.env.ANTHROPIC_API_KEY = "sk-test"
    try {
      expect((await rehearse(staged(), real.paths, { run, tmpRoot })).state).toBe("passed")
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
    expect(seen).toEqual(["config.json", "open-sessions.json", "projects", "projects/shop.yaml", "rule-packs", "rules.local.yaml"])
    expect(JSON.parse(fs.readFileSync(path.join(real.root, "open-sessions.json"), "utf8"))).toEqual({ sessions: [{ id: "real-session" }] })
    expect(hashTree(real.root)).toBe(before)
    expect(fs.readdirSync(tmpRoot)).toEqual([])
  })

  it("does not hold back a release it cannot find the parts of, and fails one that does not report", async () => {
    const real = realFolder()
    expect((await rehearse(tmp("codeh-empty-"), real.paths, { run: inProcess })).state).toBe("skipped")
    const silent: Runner = async () => ({ stdout: "listening on 47820\n", code: null })
    expect(await rehearse(staged(), real.paths, { run: silent })).toMatchObject({ state: "failed", why: expect.stringMatching(/in time/) })
  })

  it("makes the copy with a sample session the new version can read back", async () => {
    const real = realFolder()
    const syn = await syntheticDataDir(real.paths, tmp("codeh-syn-"))
    const saved = JSON.parse(fs.readFileSync(path.join(syn.dir, "open-sessions.json"), "utf8")) as { sessions: Array<{ id: string; cwd: string }> }
    expect(saved.sessions).toEqual([expect.objectContaining({ id: "00000000-0000-4000-8000-00000000e098", cwd: syn.dir })])
    expect(syn.env.GATEHOUSE_REHEARSE).toBe("1")
  })
})
