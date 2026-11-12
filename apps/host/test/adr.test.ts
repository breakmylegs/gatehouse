// D-038 and D-044: a decision in a session produces a MADR draft that links to the session, written into docs/adr only
// as accepted; the project's accepted ADRs go into the session's instructions, and an edit against one is flagged with
// the ADR named.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import type { AuditRecord } from "@gatehouse/shared/audit"
import { adrContext, adrContradictions, decisionsIn, draftAdr, nextNumber, readAdrs, writeAdr } from "../src/adr.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-adr-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const answered = {
  seq: 41,
  event: "question_answered",
  tool: "AskUserQuestion",
  verdict: { outcome: "allow" },
  inputJson: JSON.stringify({
    questions: [
      {
        header: "Database",
        question: "Which database should the orders service use?",
        options: [
          { label: "PostgreSQL", description: "relational, and the team knows it" },
          { label: "MongoDB", description: "flexible documents" },
        ],
      },
    ],
    answers: { "Which database should the orders service use?": "PostgreSQL" },
  }),
} as unknown as AuditRecord

describe("ADR capture (D-038)", () => {
  it("drafts a decision as a MADR record that links to the session, and writes it only into docs/adr", async () => {
    const [d] = decisionsIn([answered])
    expect(d).toMatchObject({ seq: 41, title: "Database", chosen: "PostgreSQL" })
    const draft = draftAdr(d!, { number: nextNumber(root), session: "s-123", date: "2026-11-12" })
    expect(draft.file).toBe("docs/adr/0001-database.md")
    expect(draft.text).toContain("session: s-123")
    expect(draft.text).toContain("record: 41")
    expect(draft.text).toContain('Chosen option: "PostgreSQL", because relational, and the team knows it.')
    expect(draft.text).toContain("* MongoDB: flexible documents")
    await expect(writeAdr(root, "src/evil.md", "x")).rejects.toThrow(/only as docs\/adr/)
    expect(await writeAdr(root, draft.file, draft.text)).toBe("docs/adr/0001-database.md")
    await expect(writeAdr(root, draft.file, draft.text)).rejects.toThrow(/already there/)
    expect(nextNumber(root)).toBe(2)
  })
})

describe("ADR-aware context (D-044)", () => {
  it("gives the session the accepted ADRs and flags an edit that contradicts one, with the ADR named", () => {
    fs.writeFileSync(
      path.join(root, "docs", "adr", "0002-postgres-only.md"),
      "---\nstatus: accepted\nforbids: [mongoose, mongodb]\npaths: [\"src/**\"]\n---\n# 0002. Use PostgreSQL for orders\n\nChosen option: \"PostgreSQL\".\n",
    )
    fs.writeFileSync(path.join(root, "docs", "adr", "0003-old.md"), "---\nstatus: superseded\nforbids: [fetch]\n---\n# 0003. No fetch\n")
    const adrs = readAdrs(root)
    const context = adrContext(adrs, ["src/orders/db.ts"])
    expect(context).toContain('Use PostgreSQL for orders: "PostgreSQL". (docs/adr/0002-postgres-only.md); it rules out mongoose, mongodb')
    expect(context).not.toContain("No fetch")
    fs.mkdirSync(path.join(root, "src", "orders"), { recursive: true })
    const found = adrContradictions(root, adrs, "Write", { file_path: path.join(root, "src", "orders", "db.ts"), content: "import mongoose from 'mongoose'\n" })
    expect(found.map((f) => [f.adr.file, f.word])).toEqual([["docs/adr/0002-postgres-only.md", "mongoose"]])
    // Outside the ADR's paths, and a superseded ADR's word, are not flagged.
    expect(adrContradictions(root, adrs, "Write", { file_path: path.join(root, "scripts", "seed.ts"), content: "import mongoose from 'mongoose'\n" })).toEqual([])
    expect(adrContradictions(root, adrs, "Write", { file_path: path.join(root, "src", "x.ts"), content: "fetch('/x')\n" })).toEqual([])
  })
})
