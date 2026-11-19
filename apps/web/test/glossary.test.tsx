// @vitest-environment jsdom
// D-083: a clash is said in words, with the names behind each word and the one to keep.
import { describe, expect, it } from "vitest"
import { clashText } from "../src/components/Glossary"

describe("a word clash in words (D-083)", () => {
  it("names each word with an example and says which to keep", () => {
    const c = {
      words: [
        { word: "customer", names: 4, examples: [{ name: "loadCustomer", file: "a.ts" }] },
        { word: "client", names: 1, examples: [{ name: "chargeClient", file: "b.ts" }] },
      ],
      keep: "customer",
      from: "built-in" as const,
    }
    expect(clashText(c)).toBe("customer (4 names, such as loadCustomer) and client (1 name, such as chargeClient) look like one thing. Most names use customer.")
    expect(clashText({ ...c, keep: "client", from: "project" })).toMatch(/Your glossary keeps client\.$/)
  })
})
