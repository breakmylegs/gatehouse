/** T-128: your own model prices and counted-as, one to a line, as Settings, Usage shows and reads them. */
export interface ModelPrice {
  model: string
  inputPerM?: number
  outputPerM?: number
  cacheReadPerM?: number
  cacheWritePerM?: number
  countAs?: string
}

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:\-[\]/]{0,99}$/

/** "model = 3, 15" (input and output, dollars a million tokens, then cache read and write if you like), or "model as other". */
export function pricingText(list: readonly ModelPrice[]): string {
  return list
    .map((p) =>
      p.countAs
        ? `${p.model} as ${p.countAs}`
        : `${p.model} = ${[p.inputPerM, p.outputPerM, p.cacheReadPerM, p.cacheWritePerM]
            .map((n) => (n === undefined ? "" : String(n)))
            .join(", ")
            .replace(/(, )+$/, "")}`,
    )
    .join("\n")
}

export function parsePricing(text: string): { prices: ModelPrice[]; errors: string[] } {
  const prices: ModelPrice[] = []
  const errors: string[] = []
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim()
    if (!line) continue
    const as = /^(\S+)\s+as\s+(\S+)$/i.exec(line)
    if (as) {
      if (!MODEL.test(as[1]!) || !MODEL.test(as[2]!)) errors.push(`Line ${i + 1}: those are not model names.`)
      else prices.push({ model: as[1]!, countAs: as[2]! })
      continue
    }
    const eq = line.indexOf("=")
    const model = (eq < 0 ? line : line.slice(0, eq)).trim()
    if (!MODEL.test(model) || eq < 0) {
      errors.push(`Line ${i + 1}: write "model = input, output" or "model as other-model".`)
      continue
    }
    const nums = line
      .slice(eq + 1)
      .split(",")
      .map((s) => s.trim())
    if (nums.length > 4 || nums.some((n) => n !== "" && !(Number(n) >= 0 && Number(n) <= 10_000))) {
      errors.push(`Line ${i + 1}: up to four prices, each 0 to 10000 dollars a million tokens.`)
      continue
    }
    const at = (k: number) => (nums[k] !== undefined && nums[k] !== "" ? Number(nums[k]) : undefined)
    const p: ModelPrice = { model }
    if (at(0) !== undefined) p.inputPerM = at(0)
    if (at(1) !== undefined) p.outputPerM = at(1)
    if (at(2) !== undefined) p.cacheReadPerM = at(2)
    if (at(3) !== undefined) p.cacheWritePerM = at(3)
    if (Object.keys(p).length === 1) errors.push(`Line ${i + 1}: give at least one price.`)
    else prices.push(p)
  }
  if (prices.length > 50) errors.push("At most 50 lines.")
  return { prices, errors }
}
