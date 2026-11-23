// @vitest-environment jsdom
// E-074: you answer a drill in the app and get an explanation; the question opens its code.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Drills } from "../src/components/Drills"
import type { Drill } from "../src/lib/drills"

afterEach(cleanup)

const D: Drill = {
  id: "t:0:where",
  tour: "T",
  kind: "where",
  prompt: "Which file is Pricing.total in?",
  choices: ["src/a.ts", "src/services/pricing.ts"],
  answer: 1,
  explanation: "Pricing.total is in src/services/pricing.ts, at line 4.",
  link: { file: "src/services/pricing.ts", line: 4 },
}

describe("the drills in the app", () => {
  it("explains a wrong answer, counts it, and opens the code", () => {
    const onOpen = vi.fn()
    const onAnswer = vi.fn()
    render(<Drills drills={[D]} onOpen={onOpen} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole("button", { name: "src/a.ts" }))
    expect(screen.getByText(/Not quite\. Pricing\.total is in src\/services\/pricing\.ts, at line 4\./)).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("0 of 1 answered right.")
    expect(onAnswer).toHaveBeenCalledWith(D, false)
    // Answered once: the choices are closed.
    expect((screen.getByRole("button", { name: "src/services/pricing.ts" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "(the code)" }))
    expect(onOpen).toHaveBeenCalledWith("src/services/pricing.ts", 4)
  })
})
