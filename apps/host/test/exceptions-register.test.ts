// E-078: a grant expiring tomorrow shows a reminder; the register says who granted each grant and why, with its scope
// and expiry, and exports as CSV.
import { describe, expect, it } from "vitest"
import type { AuditRecord } from "@gatehouse/shared/audit"
import { register, registerCsv, reminders, GRANT_EVENT } from "../src/exceptions-register.js"

const NOW = new Date(2026, 10, 20, 9, 0, 0)
const at = (days: number, hour = 12) => new Date(2026, 10, 20 + days, hour, 0, 0).toISOString()
const rec = (event: string, input: unknown, channel = "desktop", reason = "r", project = "shop") => ({ event, inputJson: JSON.stringify(input), channel, project, ts: at(-1), verdict: { reason } }) as unknown as AuditRecord

const ENTRIES = [
  { id: "npm-test", tool: "Bash", command: "npm test", project: "shop", createdAt: at(-29) },
  { id: "docs-site", tool: "WebFetch", host: "docs.example.com" },
  { id: "old", tool: "Bash", command: "make", createdAt: at(-60) },
]
const LIMITS = { "npm-test": { expiresAt: at(1), scope: "C:/dev/shop", maxUses: 50 }, "docs-site": { expiresAt: at(20) }, old: { expiresAt: at(-1) } }
const RECORDS = [
  rec(GRANT_EVENT, { id: "npm-test", why: "Runs the project's tests" }, "phone"),
  rec("tool_granted", { tool: "WebFetch" }, "desktop", "You allowed WebFetch for this session"),
  rec("decision", { id: "npm-test" }),
]

describe("policy exceptions register", () => {
  it("shows a reminder for a grant expiring tomorrow, and none for later or expired ones", () => {
    const r = register({ entries: ENTRIES, limits: LIMITS, records: RECORDS })
    expect(reminders(r.grants, NOW)).toEqual([{ id: "npm-test", expiresAt: at(1), inDays: 1, text: "The grant for Bash npm test ends tomorrow, in shop. Renew it, or let it go." }])
    expect(reminders([{ ...r.grants[0]!, expiresAt: at(0, 18) }], NOW)[0]!.text).toMatch(/ends today/)
  })

  it("says who granted each grant and why, with its scope and expiry, and lists the exceptions", () => {
    const r = register({ entries: ENTRIES, limits: LIMITS, records: RECORDS })
    expect(r.grants[0]).toEqual({ id: "npm-test", tool: "Bash", covers: "npm test", project: "shop", folder: "C:/dev/shop", maxUses: 50, createdAt: at(-29), expiresAt: at(1), grantedBy: "you, on the phone", why: "Runs the project's tests" })
    expect(r.grants[1]).toMatchObject({ covers: "docs.example.com", grantedBy: "not recorded (made before the register)", why: "not recorded" })
    expect(r.exceptions).toEqual([{ at: at(-1), kind: "a tool allowed for a whole session", project: "shop", who: "you, on the desktop", why: "You allowed WebFetch for this session" }])
  })

  it("exports as CSV, safely for a spreadsheet", () => {
    const csv = registerCsv(register({ entries: [{ id: "x", tool: "Bash", command: "=cmd|' /C calc'!A0" }], limits: {}, records: [] }))
    const lines = csv.trim().split("\r\n")
    expect(lines[0]).toBe("kind,id,tool,covers,project,folder,max uses,created,expires,granted by,why")
    expect(lines[1]).toMatch(/^grant,x,Bash,'=cmd\|' \/C calc'!A0,/)
  })
})
