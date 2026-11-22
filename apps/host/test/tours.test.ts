// D-079: each tour step links to a real symbol through the code index; a step broken by a later change is flagged.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CodeIndex } from "../src/code-index.js"
import { checkTour, readTours, tourPrompt } from "../src/tours.js"

let root: string
let data: string
let index: CodeIndex
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-tour-"))
  data = fs.mkdtempSync(path.join(os.tmpdir(), "gh-tour-data-"))
  write("src/cart.ts", "export function addItem(id: string) { return id }\nexport class Cart {}\n")
  write("src/price.ts", "export function totalPrice(n: number) { return n }\n")
  write(
    ".codehouse/tours/checkout.json",
    JSON.stringify({
      title: "How checkout works",
      steps: [
        { title: "Adding", symbol: "addItem", file: "src/cart.ts", note: "Where an item enters the cart." },
        { title: "The cart", symbol: "Cart", file: "src/cart.ts" },
        { title: "Pricing", symbol: "totalPrice", file: "src/price.ts" },
      ],
    }),
  )
  write(".codehouse/tours/broken.json", "{ not json")
  index = new CodeIndex({ dir: data, root, blocked: () => false })
  await index.refresh()
})
afterEach(() => {
  index.close()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(data, { recursive: true, force: true })
})

describe("codebase tours", () => {
  it("links each step to its symbol's line, and leaves out a file that is not a tour", () => {
    const { tours, errors } = readTours(root)
    expect(errors).toEqual(["broken.json: not JSON"])
    expect(tours.map((t) => t.title)).toEqual(["How checkout works"])
    expect(checkTour(tours[0]!, (n) => index.symbols(n)).map((s) => [s.symbol, s.state, s.at])).toEqual([
      ["addItem", "ok", { file: "src/cart.ts", line: 1 }],
      ["Cart", "ok", { file: "src/cart.ts", line: 2 }],
      ["totalPrice", "ok", { file: "src/price.ts", line: 1 }],
    ])
  })

  it("flags a step whose symbol moved to another file, or is gone, after a change", async () => {
    write("src/cart.ts", "export class Cart {}\nexport function addItemLater() {}\n")
    write("src/items.ts", "\n\nexport function addItem(id: string) { return id }\n")
    write("src/price.ts", "export function priceOf(n: number) { return n }\n")
    await index.refresh()
    const steps = checkTour(readTours(root).tours[0]!, (n) => index.symbols(n))
    expect(steps.map((s) => [s.symbol, s.state, s.at])).toEqual([
      ["addItem", "moved", { file: "src/items.ts", line: 3 }],
      ["Cart", "ok", { file: "src/cart.ts", line: 1 }],
      ["totalPrice", "gone", undefined],
    ])
  })

  it("asks Claude for a tour in the format it reads", () => {
    expect(tourPrompt("the checkout flow")).toMatch(/^Write a codebase tour of the checkout flow for a newcomer, as \.codehouse\/tours\/the-checkout-flow\.json\./)
  })
})
