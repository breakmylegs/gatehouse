// E-074: each drill question links to its code, its answer is right, and it gets an explanation.
import { describe, expect, it } from "vitest"
import { makeDrills } from "../src/lib/drills"

const TOURS = [
  {
    name: "checkout",
    title: "The checkout",
    steps: [
      { title: "The route", symbol: "createOrder", note: "Takes the basket and starts an order.", state: "ok" as const, at: { file: "src/routes/orders.ts", line: 12 } },
      { title: "Pricing", symbol: "Pricing.total", note: "Adds up the lines and the tax.", state: "ok" as const, at: { file: "src/services/pricing.ts", line: 4 } },
      { title: "Saving", symbol: "OrderRepository.save", note: "Writes the order to the database.", state: "moved" as const, at: { file: "src/data/repo.ts", line: 30 } },
      { title: "Old", symbol: "legacyCheckout", note: "Gone now.", state: "gone" as const },
    ],
  },
]

describe("code reading drills", () => {
  it("makes questions that each link to their code, with the right answer among the choices", () => {
    const d = makeDrills(TOURS)
    expect(d).toHaveLength(6)
    for (const q of d) {
      expect(q.link.file).toMatch(/^src\//)
      expect(q.link.line).toBeGreaterThan(0)
      expect(q.choices.length).toBeGreaterThanOrEqual(2)
      expect(new Set(q.choices).size).toBe(q.choices.length)
      expect(q.explanation).toContain(q.link.file)
    }
    const where = d.find((q) => q.id === "checkout:1:where")!
    expect(where).toMatchObject({ prompt: "Which file is Pricing.total in?", link: { file: "src/services/pricing.ts", line: 4 } })
    expect(where.choices[where.answer]).toBe("src/services/pricing.ts")
    const what = d.find((q) => q.id === "checkout:2:what")!
    expect(what.choices[what.answer]).toBe("Writes the order to the database.")
    expect(what.explanation).toMatch(/line 30/)
  })

  it("leaves out a step the code no longer has, and makes the same drills each time", () => {
    const d = makeDrills(TOURS)
    expect(d.some((q) => q.prompt.includes("legacyCheckout"))).toBe(false)
    expect(d.flatMap((q) => q.choices)).not.toContain("Gone now.")
    expect(makeDrills(TOURS)).toEqual(d)
    // One step alone makes no question it could not get wrong.
    expect(makeDrills([{ ...TOURS[0]!, steps: [TOURS[0]!.steps[0]!] }])).toEqual([])
  })
})
