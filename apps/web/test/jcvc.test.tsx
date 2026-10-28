// @vitest-environment jsdom
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { JcvcArt } from "../src/components/JcvcArt"
import { useStore } from "../src/store"

const web = join(__dirname, "..")

describe("Jean-Claude mode", () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({ jcMode: false })
  })

  it("is off by default and shows no extra pictures", () => {
    const { container } = render(<JcvcArt which="soldier" />)
    expect(container.querySelector("img")).toBeNull()
  })

  it("shows the picture when on, whichever theme is applied", () => {
    for (const theme of ["light", "dark"] as const) {
      useStore.setState({ theme })
      useStore.getState().setJcMode(true)
      const { container, unmount } = render(<JcvcArt which="beret" />)
      expect(container.querySelector("img[data-jcvc=beret]")).not.toBeNull()
      unmount()
    }
  })

  it("remembers the choice", () => {
    useStore.getState().setJcMode(true)
    expect(localStorage.getItem("gatehouse.jcmode")).toBe("1")
    useStore.getState().setJcMode(false)
    expect(localStorage.getItem("gatehouse.jcmode")).toBe("0")
  })

  it("has every picture on disk", () => {
    for (const f of ["loading-trucks.png", "soldier.webp", "stance.png", "beret.webp"])
      expect(existsSync(join(web, "public", "jcvc", f)), f).toBe(true)
  })
})

describe("the start-up picture", () => {
  const html = readFileSync(join(web, "index.html"), "utf8")
  it("is in index.html, not behind the mode or the theme", () => {
    expect(html).toContain('id="boot"')
    expect(html).toContain("jcvc/loading-trucks.png")
    expect(html).not.toMatch(/data-theme|jcvc="on"/)
  })
  it("is named in the title", () => {
    expect(html).toContain("<title>Jean-Claude Van Code</title>")
    expect(screen).toBeDefined()
  })
})
