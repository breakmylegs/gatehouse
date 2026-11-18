// @vitest-environment jsdom
// C-032: under a TypeScript file, its problems, what the name at the cursor is (as text, never a tooltip), and Go to
// definition (F12) and Find references as places to go to; one definition goes straight there, in another file too.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TypeScriptHelp } from "../src/components/TypeScriptHelp"

const answers: Record<string, unknown> = {
  diagnostics: { results: [{ file: "src/bill.ts", line: 3, column: 14, text: "", message: "Type 'number' is not assignable to type 'string'.", severity: "error" }] },
  info: { result: { text: "(alias) total(items: Pence[]): Pence" } },
  definition: { results: [{ file: "src/money.ts", line: 3, column: 17, text: "export function total(items: Pence[]): Pence {" }] },
  references: { results: [{ file: "src/bill.ts", line: 2, column: 20, text: "export const sum = total([1, 2])" }, { file: "src/money.ts", line: 3, column: 17, text: "export function total" }] },
}
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) => ({ ok: true, status: 200, data: answers[new URL(url, "http://x").searchParams.get("op")!] })),
}))
afterEach(cleanup)

describe("TypeScript help under a file (C-032)", () => {
  it("lists the problems, says what is at the cursor, and goes to a definition or lists references", async () => {
    const onGo = vi.fn()
    const { rerender } = render(<TypeScriptHelp sessionId="s1" rel="src/bill.ts" pos={40} ask={0} onGo={onGo} />)
    expect(await screen.findByText("Problems: 1 error, 0 other")).toBeTruthy()
    expect(await screen.findByText("(alias) total(items: Pence[]): Pence")).toBeTruthy()
    // F12 (a new ask) with one definition: straight there, in its own file.
    rerender(<TypeScriptHelp sessionId="s1" rel="src/bill.ts" pos={40} ask={1} onGo={onGo} />)
    await vi.waitFor(() => expect(onGo).toHaveBeenCalledWith("src/money.ts", 3))
    fireEvent.click(screen.getByRole("button", { name: "Find references" }))
    expect(await screen.findByText("References: 2")).toBeTruthy()
    fireEvent.click(screen.getByText("export const sum = total([1, 2])"))
    expect(onGo).toHaveBeenLastCalledWith("src/bill.ts", 2)
    // A problem is a place too.
    fireEvent.click(screen.getByText(/Error: Type 'number' is not assignable/))
    expect(onGo).toHaveBeenLastCalledWith("src/bill.ts", 3)
  })
})
