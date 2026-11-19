// D-032: each release's provenance is an in-toto Statement v1 with a SLSA provenance v1 predicate. It validates against
// the schema and its hashes verify: a changed file fails, and so does a changed session; the sessions behind a release
// come from their commits' git notes.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildStatement, PREDICATE_TYPE, sessionNotes, Statement, STATEMENT_TYPE, verifyStatement } from "../src/slsa.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-slsa-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const make = () => {
  fs.writeFileSync(path.join(dir, "Codehouse-Setup.exe"), "installer bytes")
  fs.writeFileSync(path.join(dir, "update.json"), '{"version":"2.0.500"}')
  return buildStatement({
    files: [path.join(dir, "Codehouse-Setup.exe"), path.join(dir, "update.json")],
    repo: "breakmylegs/gatehouse",
    tag: "v2.0.500",
    commit: "a".repeat(40),
    version: "2.0.500",
    notes: [
      { commit: "b".repeat(40), session: "s-1", auditSeq: 41, auditHash: "c".repeat(64), evidence: "d".repeat(64) },
      { commit: "e".repeat(40), session: "s-1", auditSeq: 57, auditHash: "f".repeat(64) },
    ],
    startedOn: "2026-11-19T01:00:00.000Z",
    finishedOn: "2026-11-19T01:20:00.000Z",
  })
}

describe("agent-aware build provenance (D-032)", () => {
  it("is a SLSA provenance v1 statement that validates, names each file by hash and each session's commits, audit and evidence", () => {
    const st = make()
    expect(Statement.safeParse(JSON.parse(JSON.stringify(st))).success).toBe(true)
    expect(st._type).toBe(STATEMENT_TYPE)
    expect(st.predicateType).toBe(PREDICATE_TYPE)
    expect(st.subject.map((s) => s.name)).toEqual(["Codehouse-Setup.exe", "update.json"])
    expect(st.predicate.buildDefinition.resolvedDependencies?.[0]?.digest).toEqual({ gitCommit: "a".repeat(40) })
    const b = st.predicate.runDetails.byproducts!
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ name: "codehouse-session/s-1", annotations: { commits: ["b".repeat(40), "e".repeat(40)], audit: [{ seq: 41 }, { seq: 57 }], evidence: ["d".repeat(64)] } })
    expect(verifyStatement(st, dir)).toEqual({ ok: true })
  })

  it("fails to verify when a file or a session changes, or when it is not a statement", () => {
    const st = make()
    fs.writeFileSync(path.join(dir, "update.json"), '{"version":"9.9.9"}')
    expect(verifyStatement(st, dir)).toMatchObject({ ok: false, why: expect.stringMatching(/update\.json is not the file/) })
    const again = make()
    const forged = JSON.parse(JSON.stringify(again)) as typeof again
    ;(forged.predicate.runDetails.byproducts![0]!.annotations as { commits: string[] }).commits[0] = "9".repeat(40)
    expect(verifyStatement(forged, dir)).toMatchObject({ ok: false, why: expect.stringMatching(/does not match its own hash/) })
    expect(verifyStatement({ ...again, predicateType: "https://example.com/other" }, dir)).toMatchObject({ ok: false })
  })

  it("finds the sessions behind a range of commits from their Codehouse notes, and leaves other notes out", { timeout: 120_000 }, () => {
    const env = { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "false" }
    const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: dir, env, encoding: "utf8" }).trim()
    g("init", "-q")
    fs.writeFileSync(path.join(dir, "a.txt"), "1")
    g("add", "-A")
    g("commit", "-qm", "before the release range")
    const base = g("rev-parse", "HEAD")
    for (const [i, note] of [JSON.stringify({ codehouse: 1, session: "s-9", auditSeq: 7, auditHash: "1".repeat(64), evidence: "2".repeat(64) }), "a note of someone else's"].entries()) {
      fs.writeFileSync(path.join(dir, "a.txt"), String(i + 2))
      g("add", "-A")
      g("commit", "-qm", `change ${i}`)
      g("notes", "--ref=codehouse", "add", "-m", note)
    }
    expect(sessionNotes(dir, `${base}..HEAD`)).toEqual([{ commit: expect.stringMatching(/^[0-9a-f]{40}$/), session: "s-9", auditSeq: 7, auditHash: "1".repeat(64), evidence: "2".repeat(64) }])
  })
})
