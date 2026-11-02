// @vitest-environment jsdom
// The window follows a Windows theme change while it runs, until you choose a theme yourself (interface research U15).
import { beforeEach, describe, expect, it, vi } from "vitest"

type Listener = () => void
let dark = false
const listeners: Listener[] = []

function stubMedia() {
  listeners.length = 0
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() {
      return q.includes("dark") && dark
    },
    media: q,
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: () => undefined,
  }))
}
const windowsChangesTo = (to: "light" | "dark") => {
  dark = to === "dark"
  for (const l of listeners) l()
}
async function freshStore() {
  vi.resetModules()
  return (await import("../src/store")).useStore
}

beforeEach(() => {
  localStorage.clear()
  dark = false
  stubMedia()
})

describe("the theme follows Windows", () => {
  it("starts in the Windows theme and changes with it while no choice is kept", async () => {
    dark = true
    const store = await freshStore()
    expect(store.getState()).toMatchObject({ theme: "dark", themeFollows: true })
    windowsChangesTo("light")
    expect(store.getState().theme).toBe("light")
    windowsChangesTo("dark")
    expect(store.getState().theme).toBe("dark")
  })

  it("stops following once you choose, and keeps your choice", async () => {
    const store = await freshStore()
    store.getState().setTheme("light")
    expect(store.getState().themeFollows).toBe(false)
    windowsChangesTo("dark")
    expect(store.getState().theme).toBe("light")
    expect(localStorage.getItem("gatehouse.theme")).toBe("light")
  })

  it("keeps a choice kept before, across a restart", async () => {
    localStorage.setItem("gatehouse.theme", "dark")
    const store = await freshStore()
    expect(store.getState()).toMatchObject({ theme: "dark", themeFollows: false })
    windowsChangesTo("light")
    expect(store.getState().theme).toBe("dark")
  })

  it("follows again from Follow Windows theme, at once", async () => {
    localStorage.setItem("gatehouse.theme", "light")
    dark = true
    const store = await freshStore()
    store.getState().followSystem()
    expect(store.getState()).toMatchObject({ theme: "dark", themeFollows: true })
    expect(localStorage.getItem("gatehouse.theme")).toBeNull()
    windowsChangesTo("light")
    expect(store.getState().theme).toBe("light")
  })
})
