// @vitest-environment jsdom
// O35 (owner, 14 Nov): the session strip along the top names each session rather than showing its code, and runs most
// recently active first; an older Host without activeAt falls back to when the session started.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { byActivity, CommandDeck } from "../src/components/CommandDeck"
import { sessionCode } from "../src/lib/codes"
import { MAIN_ACCOUNT, useStore } from "../src/store"

const s = (id: string, o: Record<string, unknown>) => ({
  id,
  cwd: `C:\\dev\\${id}`,
  project: id,
  mode: "default",
  state: "idle",
  pendingApprovals: 0,
  createdAt: "2026-11-14T08:00:00Z",
  ...o,
})

afterEach(cleanup)

describe("the session strip (O35)", () => {
  it("shows each session's name, not its code, most recently active first", () => {
    useStore.setState({
      activeAccount: MAIN_ACCOUNT,
      sessions: {
        shop: s("shop", { activeAt: "2026-11-14T09:00:00Z" }),
        docs: s("docs", { title: "Write the guide", activeAt: "2026-11-14T11:00:00Z", state: "running" }),
        blog: s("blog", { activeAt: "2026-11-14T10:00:00Z" }),
      },
    } as never)
    render(<CommandDeck />)
    const chips = within(screen.getByRole("group", { name: "Live sessions" })).getAllByRole("button")
    expect(chips.map((c) => c.textContent)).toEqual(["Write the guide", "blog", "shop"])
    expect(chips[0]!.textContent).not.toContain(sessionCode({ id: "docs", project: "docs" }))
  })

  it("falls back to when a session started, for a Host that does not say", () => {
    const list = byActivity([
      s("a", { createdAt: "2026-11-14T08:00:00Z" }),
      s("b", { createdAt: "2026-11-14T09:00:00Z" }),
      s("c", { createdAt: "2026-11-14T07:00:00Z", activeAt: "2026-11-14T12:00:00Z" }),
    ])
    expect(list.map((x) => x.id)).toEqual(["c", "b", "a"])
  })
})
