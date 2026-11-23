// E-066: an item under legal hold survives past its retention; an expired pack is deleted and audited; deletion never
// goes through a junction, and retention follows the project's classification.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EvidenceService, EvidenceStore, type EvidenceDeps } from "../src/evidence.js"
import { LogStore } from "../src/log-capture.js"
import { DEFAULT_RETENTION, LegalHolds, retentionDays } from "../src/retention.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }) : []) {
      const p = path.join(d, String(e))
      try {
        if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p)
      } catch {
        // gone
      }
    }
    fs.rmSync(d, { recursive: true, force: true })
  }
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-retain-"))
  dirs.push(d)
  return d
}
const DAY = 86_400_000

function packIn(dir: string, name: string, project: string, ageDays: number) {
  const file = path.join(dir, `${name.repeat(64).slice(0, 64)}.json`)
  fs.writeFileSync(file, JSON.stringify({ v: 1, project }))
  const t = new Date(Date.now() - ageDays * DAY)
  fs.utimesSync(file, t, t)
  return file
}

function service(dir: string, holds: LegalHolds, record = vi.fn(async () => true)) {
  const config = { dataClassification: { default: "internal" as const, projects: { vault: "restricted" as const } } }
  const svc = new EvidenceService({
    store: new EvidenceStore({ dir, redact: (t) => t }),
    auditDir: path.join(dir, "..", "audit"),
    checkpoints: {} as never,
    audit: { record },
    version: () => "1",
    retentionDays: () => 90,
    retentionFor: (p: string | undefined) => retentionDays(config, "evidence", p),
    held: (p: string | undefined) => holds.held(p, "evidence"),
    log: () => undefined,
  } as unknown as EvidenceDeps)
  return { svc, record }
}

describe("retention and legal hold", () => {
  it("keeps a pack under legal hold past its retention, and deletes and audits an expired one", async () => {
    const root = tmp()
    const dir = path.join(root, "evidence")
    fs.mkdirSync(dir)
    const holds = new LegalHolds(path.join(root, "legal-holds.json"))
    await holds.place({ project: "shop", reason: "litigation 2026-17" })
    const held = packIn(dir, "a", "shop", 400)
    const expired = packIn(dir, "b", "blog", 100)
    const fresh = packIn(dir, "c", "blog", 10)
    const { svc, record } = service(dir, holds)
    expect(await svc.prune()).toBe(1)
    expect(fs.existsSync(held)).toBe(true)
    expect(fs.existsSync(expired)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
    expect(record).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ event: "retention_deleted", project: "blog", input: expect.objectContaining({ kind: "evidence", file: path.basename(expired), ageDays: 100 }) }))
    // Released, the hold no longer keeps it.
    await new LegalHolds(path.join(root, "legal-holds.json")).release(holds.list()[0]!.id)
    expect(await service(dir, new LegalHolds(path.join(root, "legal-holds.json"))).svc.prune()).toBe(1)
    expect(fs.existsSync(held)).toBe(false)
  })

  it("keeps restricted data no longer than its classification allows", async () => {
    const root = tmp()
    const dir = path.join(root, "evidence")
    fs.mkdirSync(dir)
    const vault = packIn(dir, "d", "vault", DEFAULT_RETENTION.restricted.evidence + 1)
    const shop = packIn(dir, "e", "shop", DEFAULT_RETENTION.restricted.evidence + 1)
    await service(dir, new LegalHolds()).svc.prune()
    expect(fs.existsSync(vault)).toBe(false)
    expect(fs.existsSync(shop)).toBe(true)
    expect(retentionDays({ evidence: { retentionDays: 365 }, dataClassification: { projects: { vault: "restricted" } } }, "evidence", "vault")).toBe(DEFAULT_RETENTION.restricted.evidence)
    expect(retentionDays({ evidence: { retentionDays: 365 } }, "evidence", "shop")).toBe(365)
    expect(retentionDays({ retention: { internal: { logs: 30 } } }, "logs", "shop")).toBe(30)
  })

  it("never deletes through a junction, and a hold on every project covers each", async () => {
    const root = tmp()
    const dir = path.join(root, "evidence")
    const outside = path.join(root, "outside")
    fs.mkdirSync(dir)
    fs.mkdirSync(outside)
    const precious = path.join(outside, `${"f".repeat(64)}.json`)
    fs.writeFileSync(precious, "{}")
    const t = new Date(Date.now() - 400 * DAY)
    fs.utimesSync(precious, t, t)
    // A junction named and dated like an expired pack: neither it nor what it points to is touched.
    const link = path.join(dir, `${"7".repeat(64)}.json`)
    fs.symlinkSync(outside, link, "junction")
    fs.lutimesSync(link, t, t)
    expect(Date.now() - fs.lstatSync(link).mtimeMs).toBeGreaterThan(300 * DAY)
    await service(dir, new LegalHolds()).svc.prune()
    expect(fs.existsSync(precious)).toBe(true)
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    const all = new LegalHolds()
    await all.place({ reason: "regulator's request" })
    expect(all.held("anything", "logs")).toBe(true)
    const only = new LegalHolds()
    await only.place({ project: "shop", kind: "logs", reason: "x" })
    expect(only.held("shop", "evidence")).toBe(false)
    expect(only.held("SHOP", "logs")).toBe(true)
  })

  it("holds every deletion when the hold file cannot be read", () => {
    const root = tmp()
    fs.writeFileSync(path.join(root, "legal-holds.json"), "{ not json")
    expect(new LegalHolds(path.join(root, "legal-holds.json")).held("shop", "evidence")).toBe(true)
  })

  it("keeps a held project's log lines past their retention", () => {
    const root = tmp()
    let held = true
    const logs = new LogStore(root, (t) => t, () => 1, () => held)
    const old = new Date(Date.now() - 5 * DAY).toISOString()
    logs.append("shop", "app.log", JSON.stringify({ time: old, level: "info", msg: "kept" }))
    logs.append("shop", "app.log", JSON.stringify({ time: new Date().toISOString(), level: "info", msg: "new" }))
    const file = fs.readdirSync(root).find((f) => f.endsWith(".jsonl"))!
    expect(fs.readFileSync(path.join(root, file), "utf8")).toMatch(/kept/)
    held = false
    logs.prune("shop")
    expect(fs.readFileSync(path.join(root, file), "utf8")).not.toMatch(/kept/)
  })
})
