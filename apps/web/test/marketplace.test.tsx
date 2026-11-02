// @vitest-environment jsdom
// W1-19: the marketplace page shows what each plugin holds, says why one is refused with no Install, and installs
// only after you confirm.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { holds, Marketplace } from "../src/surfaces/Marketplace"

const posts: Array<{ url: string; body: unknown }> = []
const plain = {
  commands: 1,
  agents: 0,
  skills: 2,
  hooks: false,
  mcpServers: false,
  lspServers: false,
  dependencies: 0,
}
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    if (method === "POST") {
      posts.push({ url, body })
      return { ok: true, status: 200, data: { message: "ok" } }
    }
    return {
      ok: true,
      status: 200,
      data: {
        marketplaces: ["test-market"],
        plugins: [
          { id: "plain@test-market", name: "plain", marketplace: "test-market", contents: plain },
          {
            id: "hooky@test-market",
            name: "hooky",
            marketplace: "test-market",
            contents: { ...plain, hooks: true },
            refusal: "It has hooks, which run commands outside the Approver.",
          },
        ],
      },
    }
  }),
}))

afterEach(() => {
  cleanup()
  posts.length = 0
})

describe("the marketplace page", () => {
  it("shows what each plugin holds, and no Install for one Codehouse refuses", async () => {
    render(<Marketplace />)
    const hooky = (await screen.findByText("hooky")).closest("li")!
    expect(within(hooky).getByText("Hooks")).toBeTruthy()
    expect(within(hooky).getByText(/does not install it\. It has hooks/)).toBeTruthy()
    expect(within(hooky).queryByRole("button", { name: /install/i })).toBeNull()
    expect(holds(plain)).toEqual(["2 skills", "1 command"])
    expect(holds({ ...plain, hooks: true, mods: true })).toEqual(["A mod", "2 skills", "1 command"])
    expect(holds(undefined)).toEqual(["Not readable before installing"])
  })

  it("installs only after you confirm", async () => {
    render(<Marketplace />)
    const row = (await screen.findByText("plain")).closest("li")!
    fireEvent.click(within(row).getByRole("button", { name: "Install…" }))
    expect(posts).toHaveLength(0)
    fireEvent.click(within(row).getByRole("button", { name: "Install" }))
    await waitFor(() =>
      expect(posts).toEqual([
        { url: "/api/marketplace/install", body: { id: "plain@test-market" } },
      ]),
    )
  })
})
