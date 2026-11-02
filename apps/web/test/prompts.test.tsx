// @vitest-environment jsdom
// W1-14: saved prompts from the + menu. A prompt with {{blanks}} asks for each one before it goes into the prompt box.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PlusMenu } from "../src/components/PlusMenu"
import { fillPrompt, variablesOf } from "../src/lib/prompts"

vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) =>
    url === "/api/prompts"
      ? {
          ok: true,
          status: 200,
          data: {
            prompts: [
              {
                id: "a",
                title: "Review",
                text: "Review {{file}} for {{ risk }}, then {{file}} again.",
                at: "",
              },
              { id: "b", title: "Plain", text: "Say hello.", at: "" },
            ],
          },
        }
      : { ok: false, status: 404, error: "no route" },
  ),
}))

afterEach(cleanup)

describe("prompt blanks", () => {
  it("are found once each, in order, and an empty one stays visible", () => {
    expect(variablesOf("Review {{file}} for {{ risk }}, then {{file}}.")).toEqual(["file", "risk"])
    expect(fillPrompt("Review {{file}} for {{ risk }}.", { file: "a.ts", risk: " " })).toBe(
      "Review a.ts for {{ risk }}.",
    )
  })
})

describe("saved prompts in the + menu", () => {
  it("asks for each blank, then puts the filled prompt in the prompt box", async () => {
    const onInsert = vi.fn()
    render(<PlusMenu sessionId="s1" meta={undefined} onInsert={onInsert} />)
    fireEvent.click(screen.getByRole("button", { name: /saved prompt/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /saved prompts/i }))
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Review/ }))
    fireEvent.change(screen.getByLabelText("file"), { target: { value: "shop.ts" } })
    fireEvent.change(screen.getByLabelText("risk"), { target: { value: "injection" } })
    fireEvent.click(screen.getByRole("button", { name: "Put it in the prompt box" }))
    await waitFor(() =>
      expect(onInsert).toHaveBeenCalledWith("Review shop.ts for injection, then shop.ts again."),
    )
  })

  it("puts a prompt with no blanks straight in", async () => {
    const onInsert = vi.fn()
    render(<PlusMenu sessionId="s1" meta={undefined} onInsert={onInsert} />)
    fireEvent.click(screen.getByRole("button", { name: /saved prompt/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /saved prompts/i }))
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Plain/ }))
    expect(onInsert).toHaveBeenCalledWith("Say hello.")
  })
})
