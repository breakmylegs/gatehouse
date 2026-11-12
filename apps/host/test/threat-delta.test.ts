// D-050, the threat model delta: a new HTTP route in a change produces a draft STRIDE entry; so do a data store, an
// outbound connection, a listener and a new dependency; a comment does not.
import { describe, expect, it } from "vitest"
import { draftMarkdown, threatDelta } from "../src/threat-delta.js"

describe("the threat model delta (D-050)", () => {
  it("drafts a STRIDE entry for a new HTTP route, and for the other things a change can add", () => {
    const drafts = threatDelta({
      added: [
        {
          file: "src/server.ts",
          lines: [
            { line: 12, text: 'app.post("/api/orders/:id/refund", async (req, res) => {' },
            { line: 13, text: "  // app.get('/old', handler) was removed" },
            { line: 20, text: "const db = new Pool({ connectionString: process.env.DB })" },
            { line: 30, text: 'const r = await fetch("https://payments.test/charge", { method: "POST" })' },
            { line: 40, text: "app.listen(8080)" },
          ],
        },
        { file: "api/views.py", lines: [{ line: 3, text: '@app.route("/admin/users")' }] },
      ],
      dependencies: [{ kind: "added", lockfile: "package-lock.json", package: { ecosystem: "npm", name: "jsonwebtoken", version: "9.0.2" } }],
    })
    expect(drafts.map((d) => [d.kind, d.what, d.where])).toEqual([
      ["endpoint", "POST /api/orders/:id/refund", "src/server.ts:12"],
      ["data store", "new Pool", "src/server.ts:20"],
      ["outbound connection", 'fetch("https://payments.test/charge', "src/server.ts:30"],
      ["listener", "app.listen", "src/server.ts:40"],
      ["endpoint", "ROUTE /admin/users", "api/views.py:3"],
      ["dependency", "jsonwebtoken 9.0.2", "package-lock.json"],
    ])
    expect(drafts[0]!.stride.map((s) => s.threat)).toEqual(["S", "T", "R", "I", "D", "E"])
    const md = draftMarkdown(drafts[0]!)
    expect(md).toContain("### New endpoint: POST /api/orders/:id/refund (src/server.ts:12)")
    expect(md).toContain("| Spoofing | Who may call it, and how is the caller authenticated? |")
  })
})
