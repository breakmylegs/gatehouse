// D-083: the ubiquitous language glossary. Two words for one thing in a project's names are flagged with examples;
// words in strings, comments and tests do not count; the project's own groups win over the built-in ones.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { glossary, singular, wordsOf } from "../src/glossary.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-gloss-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function project(name: string, files: Record<string, string>): { root: string; files: string[] } {
  const root = path.join(dir, name)
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  return { root, files: Object.keys(files) }
}

const SHOP = {
  "src/customers.ts": "export function loadCustomer(customerId: string) { const customerName = customerId; return customerName }\nexport const customerOrders = []\n",
  "src/billing.ts": "export function chargeClient(clientId: string) { const clientEmail = clientId; return clientEmail }\n",
  // One name with buyer in it is not yet a second word for customer.
  "src/legacy.ts": "export const buyerRef = 1\n",
  "src/cart.ts": "// a basket of goods, basketTotal in the old code\nexport const cartItems = []\nexport const cartTotal = 0\nconst label = 'basketLabel basketCount'\n",
  "test/basket.test.ts": "const basketOne = 1\nconst basketTwo = 2\n",
}

describe("the ubiquitous language glossary (D-083)", () => {
  it("splits names into words and folds plurals", () => {
    expect(wordsOf("customerOrders")).toEqual(["customer", "order"])
    expect(wordsOf("HTTPClientFactory")).toEqual(["http", "client", "factory"])
    expect(wordsOf("shipping_addresses")).toEqual(["shipping", "address"])
    expect(singular("categories")).toBe("category")
    expect(singular("settings")).toBe("settings")
  })

  it("flags two words for one thing in the code's names, with examples, and keeps the more used one", () => {
    const { root, files } = project("shop", SHOP)
    const g = glossary(root, files)
    expect(g.clashes).toHaveLength(1)
    const c = g.clashes[0]!
    expect(c.words.map((w) => [w.word, w.names])).toEqual([
      ["customer", 4],
      ["client", 3],
    ])
    expect(c.words[1]!.examples[0]).toEqual({ name: "chargeClient", file: "src/billing.ts" })
    expect(c).toMatchObject({ keep: "customer", from: "built-in" })
    // basket is only in a comment, a string and a test, so cart has no rival.
    expect(g.clashes.some((x) => x.words.some((w) => w.word === "basket"))).toBe(false)
    expect(g.terms.map((t) => t.word)).toContain("customer")
  })

  it("uses the project's own groups first, with its word to keep", () => {
    const { root, files } = project("own", {
      ...SHOP,
      ".codehouse/glossary.yml": "synonyms:\n  - [client, customer]\n  - [total, sum]\n  - [bad]\n",
    })
    const g = glossary(root, files)
    expect(g.clashes).toHaveLength(1)
    expect(g.clashes[0]).toMatchObject({ keep: "client", from: "project" })
  })
})
