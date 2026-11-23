// E-084: a fixture route renders as a sequence diagram with its service and repository calls; calls that cannot be
// read from the code are drawn to Unresolved and listed.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { sequenceFrom } from "../src/sequence.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const FILES: Record<string, string> = {
  "src/routes/orders.ts": `import { OrderService } from "../services/order-service.js"
import { OrderRepository } from "../data/order-repository.js"
import { validate } from "../validate.js"
import * as audit from "../audit.js"

export async function createOrder(req: Request, res: Response) {
  validate(req.body)
  const svc = new OrderService(new OrderRepository())
  const order = await svc.place(req.body)
  audit.record("order", order.id)
  console.log("placed")
  res.json(order)
}
`,
  "src/services/order-service.ts": `import { OrderRepository } from "../data/order-repository.js"
import { Pricing } from "./pricing.js"

export class OrderService {
  private pricing = new Pricing()
  constructor(private readonly repo: OrderRepository) {}

  async place(input: unknown) {
    const total = this.pricing.total(input)
    const saved = await this.repo.save({ input, total })
    this.notify(saved)
    return saved
  }

  notify(order: unknown) {
    mailer.send(order)
  }
}
`,
  "src/services/pricing.ts": `export class Pricing {
  total(input: unknown) {
    return 1
  }
}
`,
  "src/data/order-repository.ts": `export class OrderRepository {
  async save(order: unknown) {
    return db.insert("orders", order)
  }
}
`,
  "src/validate.ts": `export function validate(body: unknown) {
  return body
}
`,
  "src/audit.ts": `export function record(kind: string, id: string) {}
`,
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-seq-"))
  dirs.push(root)
  for (const [f, t] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true })
    fs.writeFileSync(path.join(root, f), t)
  }
  return root
}

describe("sequence diagrams from code paths", () => {
  it("draws a route with its service and repository calls", { timeout: 60_000 }, async () => {
    const s = await sequenceFrom(project(), Object.keys(FILES), "src/routes/orders.ts#createOrder")
    expect(s.participants).toEqual(["Caller", "orders", "validate", "OrderService", "Pricing", "OrderRepository", "Unresolved", "audit"])
    const resolved = s.calls.filter((c) => c.resolved && c.label !== "return").map((c) => `${c.from}->${c.to}: ${c.label}`)
    expect(resolved).toEqual([
      "Caller->orders: createOrder()",
      "orders->validate: validate()",
      "orders->OrderService: svc.place()",
      "OrderService->Pricing: this.pricing.total()",
      "OrderService->OrderRepository: this.repo.save()",
      "OrderService->OrderService: this.notify()",
      "orders->audit: audit.record()",
    ])
    expect(s.mermaid).toMatch(/^sequenceDiagram\n/)
    expect(s.mermaid).toContain("  orders->>OrderService: svc.place()")
    expect(s.mermaid).toContain("  OrderService->>OrderRepository: this.repo.save()")
    expect(s.mermaid).toContain("  OrderRepository-->>OrderService: return")
  })

  it("marks calls it cannot resolve, and leaves the language's built-ins out", { timeout: 60_000 }, async () => {
    const s = await sequenceFrom(project(), Object.keys(FILES), "src/routes/orders.ts#createOrder")
    expect(s.unresolved.map((c) => `${c.from}: ${c.label} (${c.file}:${c.line})`)).toEqual([
      // In the order they happen: the save's insert, then the notification.
      "OrderRepository: db.insert() (src/data/order-repository.ts:3)",
      "OrderService: mailer.send() (src/services/order-service.ts:16)",
      "orders: res.json() (src/routes/orders.ts:12)",
    ])
    expect(s.mermaid).toContain("  orders-xUnresolved: res.json() (not resolved)")
    expect(s.mermaid).not.toContain("console.log")
  })

  it("stops at the depth asked, and names a missing entry point", { timeout: 60_000 }, async () => {
    const root = project()
    const shallow = await sequenceFrom(root, Object.keys(FILES), "src/routes/orders.ts#createOrder", 1)
    expect(shallow.calls.some((c) => c.to === "OrderRepository")).toBe(false)
    expect(shallow.calls.some((c) => c.to === "OrderService")).toBe(true)
    const method = await sequenceFrom(root, Object.keys(FILES), "src/services/order-service.ts#OrderService.place", 1)
    expect(method.calls[0]).toMatchObject({ from: "Caller", to: "OrderService", label: "OrderService.place()" })
    await expect(sequenceFrom(root, Object.keys(FILES), "src/routes/orders.ts#missing")).rejects.toThrow(/no missing/)
  })
})
