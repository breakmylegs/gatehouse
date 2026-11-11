// D-062, local analysis of what an agent changed: six kinds of mistake found on the changed lines with their file and
// line, ordinary code left alone, and a Severe one escalating the next commit even in Extreme approval.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { addedLines, SAST_RULE, SastCommitGuard, scanCommitSast, scanSource } from "../src/sast.js"

const TS = `import { exec } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export async function find(db, req, name) {
  const rows = await db.query(\`SELECT * FROM users WHERE name = '\${name}'\`)
  exec("git log --author=" + req.query.author)
  const total = eval(req.body.expression)
  const agent = new https.Agent({ rejectUnauthorized: false })
  const digest = crypto.createHash("md5").update(name).digest("hex")
  const file = fs.readFileSync(path.join("/srv/files", req.params.file))
  return { rows, total, agent, digest, file }
}
`

const PY = `import hashlib, subprocess, requests

def report(cursor, user):
    cursor.execute(f"SELECT * FROM orders WHERE user = '{user}'")
    subprocess.run(f"tar czf /tmp/{user}.tgz /data/{user}", shell=True)
    requests.get("https://internal.test", verify=False)
    return hashlib.md5(user.encode()).hexdigest()
`

const CS = `using System.Security.Cryptography;
class Repo {
  void Load(Db db, string id) {
    db.Users.FromSqlRaw($"SELECT * FROM Users WHERE Id = {id}");
    var md5 = MD5.Create();
    handler.ServerCertificateCustomValidationCallback = (m, c, ch, e) => true;
  }
}
`

const BENIGN = `import { execFile } from "node:child_process"
import crypto from "node:crypto"

export async function find(db, name, file) {
  const rows = await db.query("SELECT * FROM users WHERE name = $1", [name])
  execFile("git", ["log", "--author", name])
  const parsed = JSON.parse("{}")
  const agent = new https.Agent({ rejectUnauthorized: true })
  const digest = crypto.createHash("sha256").update(name).digest("hex")
  const message = "Hello " + name
  return { rows, parsed, agent, digest, message, file }
}
`

describe("the local analysis of changed code (D-062)", () => {
  it("finds the seeded patterns with their file and line", async () => {
    const ts = await scanSource("src/find.ts", TS)
    expect(ts.map((f) => [f.kind, f.line, f.severity])).toEqual([
      ["sql", 7, "Severe"],
      ["shell", 8, "Severe"],
      ["eval", 9, "Severe"],
      ["tls", 10, "Severe"],
      ["crypto", 11, "High"],
      ["path", 12, "High"],
    ])
    expect(ts[0]).toMatchObject({ file: "src/find.ts", title: "SQL built from strings" })
    const py = await scanSource("report.py", PY)
    expect(py.map((f) => [f.kind, f.line])).toEqual([
      ["sql", 4],
      ["shell", 5],
      ["tls", 6],
      ["crypto", 7],
    ])
    const cs = await scanSource("Repo.cs", CS)
    expect(cs.map((f) => [f.kind, f.line])).toEqual([
      ["sql", 4],
      ["crypto", 5],
      ["tls", 6],
    ])
  })

  it("leaves ordinary code alone, and reads only the lines the change adds", async () => {
    expect(await scanSource("src/benign.ts", BENIGN)).toEqual([])
    // Only line 9 changed: the eval is found, the rest of the file is not this change's.
    expect((await scanSource("src/find.ts", TS, new Set([9]))).map((f) => f.kind)).toEqual(["eval"])
    expect(await scanSource("notes.md", "eval(x)")).toEqual([])
    const lines = addedLines("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -3,0 +4,2 @@\n+one\n+two\n@@ -9 +11 @@\n-x\n+three\n")
    expect([...lines.get("a.ts")!]).toEqual([4, 5, 11])
  })

  it("reads what a commit would add, and fails when it cannot", async () => {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "gh-sast-"))
    try {
      fs.mkdirSync(path.join(top, "src"))
      fs.writeFileSync(path.join(top, "src", "find.ts"), TS)
      const run = vi.fn(async (_cwd: string, args: string[]) => {
        if (args.includes("--show-toplevel")) return top
        if (args.includes("diff")) return "--- a/src/find.ts\n+++ b/src/find.ts\n@@ -9,0 +9 @@\n+  const total = eval(req.body.expression)\n"
        return ""
      })
      expect((await scanCommitSast(top, 'git commit -m "x"', run)).map((f) => [f.file, f.line, f.kind])).toEqual([
        ["src/find.ts", 9, "eval"],
      ])
      // Not a commit: nothing is read.
      expect(await scanCommitSast(top, "git status", run)).toEqual([])
      const broken = new SastCommitGuard({ run: async () => Promise.reject(new Error("not a repository")) })
      await expect(broken.severe(top, 'git commit -m "x"')).rejects.toThrow()
    } finally {
      fs.rmSync(top, { recursive: true, force: true })
    }
  })

  it("sends a commit of Severe code to a person, even in Extreme approval, and one it cannot read too", async () => {
    for (const sast of [
      { severe: async () => [{ file: "src/find.ts", line: 9, kind: "eval" as const, severity: "Severe" as const, title: "Code run from a string" }] },
      { severe: async () => Promise.reject(new Error("unreadable")) },
    ]) {
      const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
      const deps = {
        sessionId: "s1",
        cwd: "C:/p",
        project: "proj",
        approver: { evaluate: async () => ({ outcome: "allow", ruleId: "git-local", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
        broker: { request },
        audit: { record: async () => true },
        kill: () => false,
        policy: () => undefined,
        engine: {},
        pwsh: undefined,
        decided: new Set<string>(),
        extreme: () => true,
        notifyAutoApproved: () => undefined,
        log: () => undefined,
        sast,
      } as unknown as CanUseDeps
      const r = await createCanUseTool(deps)("Bash", { command: 'git commit -m "x"' }, { toolUseID: "t1", signal: new AbortController().signal } as never)
      expect(request).toHaveBeenCalledTimes(1)
      expect((request.mock.calls[0] as unknown as [{ verdict: { ruleId: string } }])[0].verdict.ruleId).toBe(SAST_RULE)
      expect(r?.behavior).toBe("deny")
    }
  })
})
