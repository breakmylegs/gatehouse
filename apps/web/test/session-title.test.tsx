// @vitest-environment jsdom
// Owner, 16 Nov: a session's code (such as DC 823) is not shown (O38), and the pull requests it opened are one small
// button beside its name, not a link each under it ("These # numbers in the title are annoying").
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PrLinksMenu } from "../src/components/PrLinksMenu"
import { SessionCode } from "../src/components/SessionCode"
import { sessionCode } from "../src/lib/codes"

afterEach(cleanup)

describe("a session's title (owner, 16 Nov)", () => {
  it("shows the session's colour and not its code", () => {
    const s = { id: "0190a7c2-1111-7000-8000-000000000823", project: "DeckyGameSync" }
    const { container } = render(<SessionCode session={s} />)
    expect(container.textContent).toBe("")
    expect(container.textContent).not.toContain(sessionCode(s))
    expect(container.querySelector(".code")?.getAttribute("style")).toContain("--ribbon")
  })

  it("puts the pull requests behind one button, newest first", () => {
    const prs = [19, 20, 21].map((n) => ({ url: `https://github.com/a/keepsake/pull/${n}`, repo: "a/keepsake", number: n }))
    render(<PrLinksMenu prs={prs} />)
    const button = screen.getByText("Pull requests (3)")
    expect(screen.queryByText("keepsake #19")).not.toBeVisible()
    fireEvent.click(button)
    const list = screen.getByRole("group", { name: "Pull requests this session opened" })
    expect(within(list).getAllByRole("link").map((a) => a.textContent)).toEqual(["keepsake #21", "keepsake #20", "keepsake #19"])
  })

  it("shows nothing when there are none, and says Pull request for one", () => {
    const { container, rerender } = render(<PrLinksMenu prs={[]} />)
    expect(container.textContent).toBe("")
    rerender(<PrLinksMenu prs={[{ url: "https://github.com/a/b/pull/1", repo: "a/b", number: 1 }]} />)
    expect(screen.getByText("Pull request")).toBeTruthy()
  })
})
