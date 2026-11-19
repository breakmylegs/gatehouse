// @vitest-environment jsdom
// T-008: the start form offers each WSL distro's home folder, and nothing when there are none.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WslFolders } from "../src/components/WslFolders"

let distros: Array<{ name: string; home?: string }> = []
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: true, status: 200, data: { distros } })) }))
afterEach(cleanup)

describe("WSL folders in the start form (T-008)", () => {
  it("puts a distro's home in the folder field", async () => {
    distros = [{ name: "Ubuntu", home: "\\\\wsl.localhost\\Ubuntu\\home\\pat" }, { name: "Debian" }]
    const onPick = vi.fn()
    render(<WslFolders onPick={onPick} />)
    fireEvent.click(await screen.findByRole("button", { name: "Ubuntu" }))
    expect(onPick).toHaveBeenCalledWith("\\\\wsl.localhost\\Ubuntu\\home\\pat")
    expect(screen.queryByRole("button", { name: "Debian" })).toBeNull()
  })

  it("shows nothing without a distro", async () => {
    distros = []
    const { container } = render(<WslFolders onPick={() => undefined} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe("")
  })
})
