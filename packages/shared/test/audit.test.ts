import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  AuditIntegrityError,
  AuditLockError,
  AuditRecord,
  AuditWriter,
  GENESIS_HASH,
  headPath,
  listAuditFiles,
  verifyAudit,
  type AuditEntry,
} from "../src/audit/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
let root: string
let n = 0

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-audit-"))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const redactHunter = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replaceAll("hunter2", "[REDACTED]")) as T

function newDir(): string {
  const dir = path.join(root, `d${n++}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    session: "s1",
    event: "evaluate_permission",
    channel: "approver",
    tool: "Bash",
    input: { command: "git status" },
    verdict: {
      outcome: "allow",
      ruleId: "safe-shell",
      reason: "ok",
      risk: 0,
      decidedBy: "rules",
      policyHash: "a".repeat(64),
    },
    latencyMs: 3,
    ...over,
  }
}

function writerFor(
  dir: string,
  now?: () => Date,
  extra: Partial<ConstructorParameters<typeof AuditWriter>[0]> = {},
) {
  return new AuditWriter({ dir, redact: redactHunter, now, ...extra })
}

async function fill(dir: string, count: number, now?: () => Date): Promise<AuditRecord[]> {
  const w = writerFor(dir, now)
  const out: AuditRecord[] = []
  for (let i = 0; i < count; i++)
    out.push(await w.append(entry({ input: { command: `echo ${i}` } })))
  return out
}

function readLines(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "")
}

describe("AuditWriter (invariant 13: audit everything, hash-chained)", () => {
  it("chains records from the genesis hash and writes a head file", async () => {
    const dir = newDir()
    const recs = await fill(dir, 3)
    expect(recs.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(recs[0]?.prevHash).toBe(GENESIS_HASH)
    expect(recs[1]?.prevHash).toBe(recs[0]?.hash)
    expect(recs[2]?.prevHash).toBe(recs[1]?.hash)
    const head = JSON.parse(fs.readFileSync(headPath(dir), "utf8"))
    expect(head).toMatchObject({ seq: 3, hash: recs[2]?.hash })
    expect(new AuditWriter({ dir, redact: (v) => v }).head()).toMatchObject({
      seq: 3,
      hash: recs[2]?.hash,
    })
    const result = verifyAudit(dir)
    expect(result).toMatchObject({ ok: true, records: 3, files: 1, problems: [] })
  })

  it("stores the input as canonical JSON and keeps every field the spec lists", async () => {
    const dir = newDir()
    const rec = await writerFor(dir).append(
      entry({
        input: { b: 1, a: [2, { d: 1, c: 2 }] },
        toolUseId: "t1",
        cwd: "C:/p",
        project: "p",
        judgeRationale: "why",
      }),
    )
    expect(rec.inputJson).toBe('{"a":[2,{"c":2,"d":1}],"b":1}')
    expect(rec).toMatchObject({
      session: "s1",
      tool: "Bash",
      toolUseId: "t1",
      cwd: "C:/p",
      project: "p",
      judgeRationale: "why",
      channel: "approver",
      latencyMs: 3,
    })
    expect(rec.verdict.ruleId).toBe("safe-shell")
    expect(rec.verdict.policyHash).toBe("a".repeat(64))
    expect(rec.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("rounds latency to whole milliseconds and never records a negative one", async () => {
    const dir = newDir()
    const w = writerFor(dir)
    expect((await w.append(entry({ latencyMs: 2.6 }))).latencyMs).toBe(3)
    expect((await w.append(entry({ latencyMs: -4 }))).latencyMs).toBe(0)
  })

  it("starts a new file each month and links the first record to the last of the month before", async () => {
    const dir = newDir()
    let clock = new Date("2026-01-31T23:59:58Z")
    const w = writerFor(dir, () => clock)
    const a = await w.append(entry())
    clock = new Date("2026-02-01T00:00:01Z")
    const b = await w.append(entry())
    expect(listAuditFiles(dir)).toEqual(["audit-2026-01.jsonl", "audit-2026-02.jsonl"])
    expect(b.seq).toBe(2)
    expect(b.prevHash).toBe(a.hash)
    expect(verifyAudit(dir).ok).toBe(true)
    expect(new AuditWriter({ dir, redact: (v) => v }).head()?.file).toBe("audit-2026-02.jsonl")
  })

  it("keeps the chain across a restart (a new writer on the same folder)", async () => {
    const dir = newDir()
    await fill(dir, 2)
    const more = await fill(dir, 2)
    expect(more.map((r) => r.seq)).toEqual([3, 4])
    expect(verifyAudit(dir)).toMatchObject({ ok: true, records: 4 })
  })

  it("redacts every field before it is stored (invariant 12)", async () => {
    const dir = newDir()
    const rec = await writerFor(dir).append(
      entry({
        session: "hunter2-session",
        cwd: "C:/clients/hunter2",
        project: "hunter2",
        input: { command: "curl -u me:hunter2 x", nested: ["hunter2"] },
        judgeRationale: "saw hunter2",
        verdict: {
          outcome: "escalate",
          ruleId: "network",
          reason: "r",
          risk: 60,
          decidedBy: "rules",
          policyHash: "a".repeat(64),
          segments: [{ text: "curl -u me:hunter2 x", ruleId: "network", outcome: "escalate" }],
        },
      }),
    )
    const file = fs.readFileSync(path.join(dir, listAuditFiles(dir)[0] as string), "utf8")
    expect(file).not.toContain("hunter2")
    expect(file).toContain("[REDACTED]")
    expect(rec.inputJson).not.toContain("hunter2")
    expect(verifyAudit(dir).ok).toBe(true)
  })

  it("will not be built without a redact function", () => {
    expect(() => new AuditWriter({ dir: newDir() } as never)).toThrow(/redact/)
  })

  it("serialises appends made at the same time in one process", async () => {
    const dir = newDir()
    const w = writerFor(dir)
    const recs = await Promise.all(
      Array.from({ length: 30 }, (_, i) => w.append(entry({ input: { i } }))),
    )
    expect(new Set(recs.map((r) => r.seq)).size).toBe(30)
    expect(verifyAudit(dir)).toMatchObject({ ok: true, records: 30 })
  })

  it("writes safely from several processes at once", async () => {
    const dir = newDir()
    const runWorker = (id: string) =>
      new Promise<{ code: number; stderr: string }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", path.join(here, "fixtures", "append-worker.ts"), dir, "20", id],
          {
            cwd: path.resolve(here, ".."),
            stdio: ["ignore", "ignore", "pipe"],
          },
        )
        let stderr = ""
        child.stderr.on("data", (d) => (stderr += String(d)))
        child.on("error", reject)
        child.on("exit", (code) => resolve({ code: code ?? 1, stderr }))
      })
    const results = await Promise.all(["a", "b", "c"].map(runWorker))
    expect(results.map((r) => r.stderr.split("\n").find((l) => l.includes("Error")) ?? "")).toEqual(
      ["", "", ""],
    )
    expect(results.map((r) => r.code)).toEqual([0, 0, 0])
    const result = verifyAudit(dir)
    expect(result).toMatchObject({ ok: true, records: 60, problems: [] })
    const sessions = readLines(path.join(dir, listAuditFiles(dir)[0] as string)).map(
      (l) => JSON.parse(l).session,
    )
    expect(new Set(sessions)).toEqual(new Set(["worker-a", "worker-b", "worker-c"]))
  }, 120000)

  it("recovers from a stale lock left by a crashed process", async () => {
    const dir = newDir()
    const lock = path.join(dir, "audit.lock")
    fs.writeFileSync(lock, "99999 long ago\n")
    const old = new Date(Date.now() - 60000)
    fs.utimesSync(lock, old, old)
    const rec = await writerFor(dir, undefined, { staleLockMs: 1000 }).append(entry())
    expect(rec.seq).toBe(1)
    expect(fs.existsSync(lock)).toBe(false)
  })

  it("gives up with a clear error when a live lock is never released", async () => {
    const dir = newDir()
    fs.writeFileSync(path.join(dir, "audit.lock"), "1 now\n")
    await expect(
      writerFor(dir, undefined, { lockTimeoutMs: 150, staleLockMs: 60000 }).append(entry()),
    ).rejects.toBeInstanceOf(AuditLockError)
    expect(fs.existsSync(headPath(dir))).toBe(false)
  })

  it("rejects (it does not pretend) when the folder cannot be written", async () => {
    const blocker = path.join(root, `file-${n++}`)
    fs.writeFileSync(blocker, "x")
    await expect(writerFor(path.join(blocker, "sub")).append(entry())).rejects.toThrow()
  })

  it("repairs a torn final line (a crash mid-write) before the next append", async () => {
    const dir = newDir()
    await fill(dir, 2)
    const file = path.join(dir, listAuditFiles(dir)[0] as string)
    fs.appendFileSync(file, '{"v":1,"seq":3,"ts":"2026-')
    expect(verifyAudit(dir).problems.some((p) => p.reason.includes("torn"))).toBe(true)
    const rec = await writerFor(dir).append(entry())
    expect(rec.seq).toBe(3)
    expect(verifyAudit(dir).ok).toBe(true)
  })

  it("does not repair when only reading the head (another process may be mid-write)", async () => {
    const dir = newDir()
    await fill(dir, 2)
    const file = path.join(dir, listAuditFiles(dir)[0] as string)
    fs.appendFileSync(file, '{"v":1,"seq":3')
    const before = fs.readFileSync(file, "utf8")
    expect(new AuditWriter({ dir, redact: (v) => v }).head()?.seq).toBe(2)
    expect(fs.readFileSync(file, "utf8")).toBe(before)
  })

  it("refuses to append to a log that has been truncated below head.json", async () => {
    const dir = newDir()
    await fill(dir, 3)
    const file = path.join(dir, listAuditFiles(dir)[0] as string)
    fs.writeFileSync(file, readLines(file).slice(0, 2).join("\n") + "\n")
    await expect(writerFor(dir).append(entry())).rejects.toBeInstanceOf(AuditIntegrityError)
  })

  it("refuses to append when the last line is not a record", async () => {
    const dir = newDir()
    await fill(dir, 1)
    fs.appendFileSync(path.join(dir, listAuditFiles(dir)[0] as string), "garbage\n")
    await expect(writerFor(dir).append(entry())).rejects.toBeInstanceOf(AuditIntegrityError)
  })

  it("copes with very long records", async () => {
    const dir = newDir()
    const w = writerFor(dir)
    await w.append(entry({ input: { command: "x".repeat(300_000) } }))
    const rec = await w.append(entry())
    expect(rec.seq).toBe(2)
    expect(verifyAudit(dir).ok).toBe(true)
  })
})

describe("verifyAudit finds tampering", () => {
  async function chain(count = 5): Promise<{ dir: string; file: string }> {
    const dir = newDir()
    await fill(dir, count)
    return { dir, file: path.join(dir, listAuditFiles(dir)[0] as string) }
  }
  const reasons = (dir: string) => verifyAudit(dir).problems.map((p) => p.reason)

  it("reports a missing folder as an empty, valid log", () => {
    expect(verifyAudit(path.join(root, "never-created"))).toMatchObject({
      ok: true,
      records: 0,
      files: 0,
    })
  })

  it("catches an edited field", async () => {
    const { dir, file } = await chain()
    const lines = readLines(file)
    lines[2] = (lines[2] as string).replace('"outcome":"allow"', '"outcome":"deny"')
    fs.writeFileSync(file, lines.join("\n") + "\n")
    const r = verifyAudit(dir)
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toMatchObject({
      line: 3,
      seq: 3,
      reason: "hash does not match the record content",
    })
  })

  it("catches an edited field even when the record's own hash is recomputed", async () => {
    const { dir, file } = await chain()
    const lines = readLines(file)
    const rec = JSON.parse(lines[1] as string)
    rec.verdict.outcome = "deny"
    const { hash: _h, ...body } = rec
    const { hashRecord } = await import("../src/audit/index.js")
    rec.hash = hashRecord(body)
    lines[1] = JSON.stringify(rec)
    fs.writeFileSync(file, lines.join("\n") + "\n")
    expect(reasons(dir)).toContain("prevHash does not match the record before it")
  })

  it("catches a deleted record", async () => {
    const { dir, file } = await chain()
    const lines = readLines(file)
    lines.splice(2, 1)
    fs.writeFileSync(file, lines.join("\n") + "\n")
    const r = reasons(dir)
    expect(r.some((x) => x.includes("does not follow"))).toBe(true)
    expect(r).toContain("prevHash does not match the record before it")
  })

  it("catches reordered records", async () => {
    const { dir, file } = await chain()
    const lines = readLines(file)
    ;[lines[1], lines[2]] = [lines[2] as string, lines[1] as string]
    fs.writeFileSync(file, lines.join("\n") + "\n")
    expect(verifyAudit(dir).ok).toBe(false)
  })

  it("catches a duplicated record", async () => {
    const { dir, file } = await chain()
    const lines = readLines(file)
    lines.splice(2, 0, lines[1] as string)
    fs.writeFileSync(file, lines.join("\n") + "\n")
    expect(verifyAudit(dir).ok).toBe(false)
  })

  it("catches removal of records from the end, using head.json", async () => {
    const { dir, file } = await chain()
    fs.writeFileSync(file, readLines(file).slice(0, 3).join("\n") + "\n")
    expect(reasons(dir).some((x) => x.includes("removed from the end"))).toBe(true)
  })

  it("catches a missing, unreadable or mismatched head.json", async () => {
    const { dir } = await chain()
    const head = fs.readFileSync(headPath(dir), "utf8")
    fs.rmSync(headPath(dir))
    expect(reasons(dir)).toContain("head.json is missing")
    fs.writeFileSync(headPath(dir), "not json")
    expect(reasons(dir)).toContain("head.json is not valid JSON")
    fs.writeFileSync(headPath(dir), JSON.stringify({ ...JSON.parse(head), hash: "f".repeat(64) }))
    expect(reasons(dir)).toContain("head.json hash does not match the last record")
    fs.writeFileSync(headPath(dir), JSON.stringify({ ...JSON.parse(head), seq: 2 }))
    expect(reasons(dir).some((x) => x.includes("behind the log"))).toBe(true)
  })

  it("catches bad JSON, blank lines, invalid records and a torn final line", async () => {
    const { dir, file } = await chain(3)
    const lines = readLines(file)
    fs.writeFileSync(
      file,
      [lines[0], "{broken", "", '{"v":1}', lines[1], lines[2]].join("\n") + "\n" + "{torn",
    )
    const r = reasons(dir)
    expect(r).toContain("not valid JSON")
    expect(r).toContain("blank line")
    expect(r.some((x) => x.startsWith("not a valid audit record"))).toBe(true)
    expect(r.some((x) => x.includes("torn final line"))).toBe(true)
  })

  it("catches a broken link between months and a record filed under the wrong month", async () => {
    const dir = newDir()
    let clock = new Date("2026-03-31T23:59:59Z")
    const w = writerFor(dir, () => clock)
    await w.append(entry())
    clock = new Date("2026-04-01T00:00:01Z")
    await w.append(entry())
    const april = path.join(dir, "audit-2026-04.jsonl")
    const rec = JSON.parse(readLines(april)[0] as string)
    rec.prevHash = "b".repeat(64)
    fs.writeFileSync(april, JSON.stringify(rec) + "\n")
    expect(reasons(dir)).toContain("prevHash does not match the record before it")
    fs.renameSync(april, path.join(dir, "audit-2026-05.jsonl"))
    expect(reasons(dir).some((x) => x.includes("belongs in a different month file"))).toBe(true)
  })

  it("keeps going after a bad record so later problems are still reported", async () => {
    const { dir, file } = await chain(6)
    const lines = readLines(file)
    lines[1] = (lines[1] as string).replace('"latencyMs":3', '"latencyMs":4')
    lines[4] = (lines[4] as string).replace('"latencyMs":3', '"latencyMs":4')
    fs.writeFileSync(file, lines.join("\n") + "\n")
    const lineNumbers = verifyAudit(dir).problems.map((p) => p.line)
    expect(lineNumbers).toEqual([2, 5])
  })
})
