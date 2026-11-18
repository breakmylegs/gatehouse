// @vitest-environment jsdom
// Uplift phase 6: CNW's own page, against a stubbed server. Each computer on the board is a link a screen reader
// reads as one, inside a list item; the Needs you count shows what waits; and removing a computer opens the danger
// notice, Cancel first and focused, sending nothing until confirmed.
import fs from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
const sent: Array<{ method: string; url: string }> = []

beforeAll(async () => {
  const html = fs.readFileSync(path.join(here, "../public/index.html"), "utf8")
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, "")
  // jsdom has no showModal: the open attribute stands in for it.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
  }
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      sent.push({ method: init?.method ?? "GET", url })
      if (url === "/api/me") return json({ access: "user", user: "ana@example.com", email: "ana@example.com", role: "owner", csrf: "t", passkeys: true })
      if (url === "/api/board")
        return json({
          board: [{ id: "c1", label: "Laptop", online: true, sessions: { total: 1, working: 0, waiting: 1 }, waiting: [{ computer: "c1", computerLabel: "Laptop", requestId: "r1", tool: "Bash", project: "billing", risk: 40, since: new Date().toISOString() }] }],
          inbox: [{ computer: "c1", computerLabel: "Laptop", requestId: "r1", tool: "Bash", project: "billing", risk: 40, since: new Date().toISOString() }],
        })
      return json({})
    }),
  )
  await import("../public/cnw.js")
  await vi.waitFor(() => expect(document.querySelector("main h1")?.textContent).toBe("Board"))
})

describe("CNW's page", () => {
  it("lists each computer as a link inside a list item, and shows what needs you", () => {
    const link = document.querySelector<HTMLAnchorElement>('[role="list"] > [role="listitem"] > a.item')!
    expect(link.getAttribute("href")).toBe("/app/?computer=c1")
    expect(link.getAttribute("role")).toBeNull()
    expect(link.getAttribute("aria-label")).toMatch(/Laptop: online, 1 waiting on you/)
    expect(document.getElementById("needs")!.textContent).toBe("1 needs you")
    expect(document.getElementById("needs")!.classList.contains("on")).toBe(true)
  })

  it("asks before removing a computer, Cancel first and focused, and sends nothing when cancelled", async () => {
    location.hash = "#you"
    await vi.waitFor(() => expect(document.querySelector("main h1")?.textContent).toBe("You"))
    const remove = await vi.waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('button[aria-label="Remove Laptop"]')
      expect(b).not.toBeNull()
      return b!
    })
    remove.click()
    const dialog = await vi.waitFor(() => {
      const d = document.querySelector("dialog[open]")
      expect(d).not.toBeNull()
      return d!
    })
    const buttons = [...dialog.querySelectorAll("button")].map((b) => b.textContent)
    expect(buttons).toEqual(["Cancel", "Remove it"])
    expect(document.activeElement?.textContent).toBe("Cancel")
    ;(dialog.querySelector("button") as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 20))
    expect(sent.some((x) => x.method === "DELETE")).toBe(false)
    expect(document.querySelector("dialog")).toBeNull()
  })
})
