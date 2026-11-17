// @vitest-environment jsdom
// T-016: models of your own, with the names you give them, in every model picker; one with a built-in id renames it.
// Settings saves the list only when every line is a model.
import { beforeEach, describe, expect, it } from "vitest"
import { GatehouseConfig } from "@gatehouse/shared/node"
import { allModels, modelLabel, modelsText, parseModels, setCustomModels } from "../src/lib/models"
import { bodyOf, valuesOf } from "../src/surfaces/Settings"

beforeEach(() => setCustomModels([]))

const data = (saved: Record<string, unknown> = {}) =>
  ({ path: "s.json", saved, running: GatehouseConfig.parse({}), workspaceRootsInEffect: [], quietHoursInPolicy: null }) as unknown as Parameters<typeof valuesOf>[0]

describe("your own models (T-016)", () => {
  it("adds them after the built-in ones, renames a built-in one, and names each by your name", () => {
    setCustomModels([
      { id: "claude-opus-5-5[1m]", label: "Opus 5.5 (long)" },
      { id: "claude-sonnet-5-5", label: "Sonnet (team)" },
    ])
    const list = allModels()
    expect(list.at(-1)).toEqual({ id: "claude-opus-5-5[1m]", label: "Opus 5.5 (long)" })
    expect(list.find((m) => m.id === "claude-sonnet-5-5")?.label).toBe("Sonnet (team)")
    expect(list.filter((m) => m.id === "claude-sonnet-5-5")).toHaveLength(1)
    expect(modelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5 (long)")
    expect(modelLabel(undefined)).toBe("Default model")
    expect(modelLabel("something-else")).toBe("something-else")
  })

  it("reads id = name lines, says which are wrong, and keeps the saved list until every line is right", () => {
    expect(parseModels("claude-x = X\n\n  bad id here = Y\nclaude-y =")).toEqual({
      models: [{ id: "claude-x", label: "X" }],
      errors: ['Line 3: "bad id here" is not a model id.', "Line 4: give it a name of 1 to 40 characters."],
    })
    const d = data({ customModels: [{ id: "claude-a", label: "A" }] })
    expect(valuesOf(d).cmText).toBe(modelsText([{ id: "claude-a", label: "A" }]))
    expect(bodyOf(d, { ...valuesOf(d), cmText: "claude-b = B" }).customModels).toEqual([{ id: "claude-b", label: "B" }])
    expect(bodyOf(d, { ...valuesOf(d), cmText: "not valid id = B" }).customModels).toEqual([{ id: "claude-a", label: "A" }])
    expect(bodyOf(d, { ...valuesOf(d), cmText: "" })).not.toHaveProperty("customModels")
  })

  it("is refused by the Host's settings check when an id is not a model id", () => {
    expect(GatehouseConfig.safeParse({ customModels: [{ id: "ok-model", label: "OK" }] }).success).toBe(true)
    expect(GatehouseConfig.safeParse({ customModels: [{ id: "bad id; rm -rf", label: "X" }] }).success).toBe(false)
  })
})

describe("prices of your own in Settings (T-128)", () => {
  it("reads prices and counted-as lines, says which are wrong, and keeps the saved list until every line is right", async () => {
    const { parsePricing, pricingText } = await import("../src/lib/pricing")
    expect(parsePricing("gateway/llama = 0.5, 2\nold-name as claude-opus-5-5\nbad = x\n = 3")).toEqual({
      prices: [
        { model: "gateway/llama", inputPerM: 0.5, outputPerM: 2 },
        { model: "old-name", countAs: "claude-opus-5-5" },
      ],
      errors: ["Line 3: up to four prices, each 0 to 10000 dollars a million tokens.", 'Line 4: write "model = input, output" or "model as other-model".'],
    })
    expect(pricingText([{ model: "m", inputPerM: 1, outputPerM: 4 }, { model: "a", countAs: "b" }])).toBe("m = 1, 4\na as b")
    const d = data({ modelPricing: [{ model: "m", inputPerM: 1 }] })
    expect(bodyOf(d, { ...valuesOf(d), priceText: "m = 2, 8" }).modelPricing).toEqual([{ model: "m", inputPerM: 2, outputPerM: 8 }])
    expect(bodyOf(d, { ...valuesOf(d), priceText: "m = lots" }).modelPricing).toEqual([{ model: "m", inputPerM: 1 }])
  })
})
