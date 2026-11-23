// E-067: every mapped flow appears in the DPIA draft, which is marked as a draft for legal review.
import { describe, expect, it } from "vitest"
import { dpiaDraft } from "../src/dpia.js"
import { scanFile, type PersonalDataMap } from "../src/personal-data.js"

const code = [
  "export async function signUp(user) {",
  "  console.log('new user', user.email)",
  "  await db.users.insert({ email: user.email, dateOfBirth: user.dateOfBirth })",
  "  await fetch('https://crm.example/api', { body: JSON.stringify({ phone: user.phone }) })",
  "}",
].join("\n")

function map(): PersonalDataMap {
  const r = scanFile("src/signup.ts", code)
  const fields = [...new Map(r.fields.map((f) => [f.name, { name: f.name, category: f.category, places: r.fields.filter((x) => x.name === f.name).length }])).values()]
  return { draft: true, scope: { root: "shop", files: 1, skipped: ["tests"] }, fields, flows: r.flows }
}

describe("DPIA draft", () => {
  it("puts every mapped flow in the draft, in the processing and the risks", () => {
    const m = map()
    expect(m.flows.length).toBeGreaterThanOrEqual(3)
    const d = dpiaDraft("shop", m)
    const nature = d.slice(d.indexOf("## 2."), d.indexOf("## 3."))
    const risks = d.slice(d.indexOf("## 6."), d.indexOf("## 7."))
    for (const [i, f] of m.flows.entries()) {
      expect(nature).toContain(`| ${i + 1} | ${f.field} | ${f.category} |`)
      expect(nature).toContain(`| ${f.file} | ${f.line} |`)
      expect(risks).toContain(`${f.field} to `)
      expect(risks).toContain(`(${f.file}:${f.line})`)
    }
    expect(new Set(m.flows.map((f) => f.sink))).toEqual(new Set(["log", "storage", "network"]))
    expect(d).toMatch(/Flows to a log: /)
    expect(d).toMatch(/Flows to a network call: /)
  })

  it("is marked as a draft for legal review, and asks for what the code cannot say", () => {
    const d = dpiaDraft("shop", map(), { residency: "Remote regions: EU." })
    expect(d).toMatch(/^# Data protection impact assessment: shop\n\n\*\*DRAFT FOR LEGAL REVIEW\.\*\*/)
    for (const s of ["## 1.", "## 4.", "## 5.", "## 7."]) expect(d.slice(d.indexOf(s)).split("\n## ")[0]).toMatch(/Needs your input/)
    expect(d).toMatch(/lawful basis/)
    expect(d).toContain("Remote regions: EU.")
    expect(d).toMatch(/## 8\. Sign-off/)
  })

  it("says so when no flow was found", () => {
    const d = dpiaDraft("empty", { draft: true, scope: { root: "empty", files: 0, skipped: [] }, fields: [], flows: [] })
    expect(d).toMatch(/no data that looks personal/)
    expect(d).toMatch(/No flow found/)
  })
})
