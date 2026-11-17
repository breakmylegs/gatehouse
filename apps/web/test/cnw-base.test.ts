// @vitest-environment jsdom
// The interface Neighbourhood Watch serves lives under /app/, so its build loads scripts and styles from /app/; the
// desktop's build is unchanged at /. And if the page's own files cannot load, the start-up picture goes and says so.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"

const here = path.dirname(fileURLToPath(import.meta.url))

async function baseFor(remote: string | undefined): Promise<string | undefined> {
  if (remote) vi.stubEnv("VITE_CODEHOUSE_REMOTE", remote)
  else vi.stubEnv("VITE_CODEHOUSE_REMOTE", "")
  vi.resetModules()
  const config = (await import("../vite.config")).default as { base?: string }
  return config.base
}

afterEach(() => vi.unstubAllEnvs())

describe("the build's base address", () => {
  it("is /app/ for Neighbourhood Watch, and / for the desktop", async () => {
    expect(await baseFor("cnw")).toBe("/app/")
    expect(await baseFor(undefined)).toBe("/")
  })
})

describe("the start-up picture when the page's files do not load", () => {
  const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8")
  const fallback = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ""

  function page() {
    document.body.innerHTML = '<div id="boot" role="status"><span>Codehouse</span></div><div id="root"></div>'
    delete (window as unknown as { __codehouseStarted?: boolean }).__codehouseStarted
    new Function(fallback)()
  }

  it("goes and says so when a script fails to load", () => {
    page()
    const s = document.createElement("script")
    document.body.append(s)
    s.dispatchEvent(new Event("error"))
    const boot = document.getElementById("boot")!
    expect(boot.getAttribute("role")).toBe("alert")
    expect(boot.textContent).toMatch(/could not start: its files did not load/)
  })

  it("stays as it is once the page's script has run", () => {
    page()
    ;(window as unknown as { __codehouseStarted?: boolean }).__codehouseStarted = true
    const s = document.createElement("script")
    document.body.append(s)
    s.dispatchEvent(new Event("error"))
    expect(document.getElementById("boot")!.getAttribute("role")).toBe("status")
  })
})
