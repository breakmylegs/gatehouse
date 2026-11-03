import { describe, expect, it } from "vitest"
import { splitStderr, usageOf, type JobUsage } from "../src/limits.js"

const feed = (chunks: string[]) => {
  const errors: string[] = []
  const usage: JobUsage[] = []
  const pass = splitStderr(
    (t) => errors.push(t),
    (u) => usage.push(u),
  )
  for (const c of chunks) pass(c)
  return { errors: errors.join(""), usage }
}

describe("what the limits helper says a session uses", () => {
  it("is taken out of the error stream, even cut across two pieces, and the rest passes on unchanged", () => {
    const r = feed([
      "a warning\n[codeh-us",
      'age] {"cpu":12.5,"memoryMb":812,"processes":7}\r\nanother',
      " line\n",
    ])
    expect(r.usage).toEqual([{ cpu: 12.5, memoryMb: 812, processes: 7 }])
    expect(r.errors).toBe("a warning\nanother line\n")
  })

  it("passes on at once what cannot be a usage line, so a warning is never held back", () => {
    const errors: string[] = []
    splitStderr((t) => errors.push(t))("canUseTool is shadowed")
    expect(errors).toEqual(["canUseTool is shadowed"])
  })

  it("refuses a usage line it cannot read, or with numbers out of range", () => {
    expect(usageOf("[codeh-usage] {not json")).toBeUndefined()
    expect(usageOf('[codeh-usage] {"cpu":-1,"memoryMb":1,"processes":1}')).toBeUndefined()
    expect(usageOf('[codeh-usage] {"cpu":250,"memoryMb":1,"processes":1}')?.cpu).toBe(100)
    expect(usageOf('{"cpu":1,"memoryMb":1,"processes":1}')).toBeUndefined()
  })
})
