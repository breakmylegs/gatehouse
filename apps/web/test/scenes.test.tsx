// @vitest-environment jsdom
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SceneBackdrop } from "../src/components/SceneBackdrop"
import { autoPictureFor, BUILTIN_PICTURES } from "../src/lib/scenes"
import { useStore } from "../src/store"

const web = join(__dirname, "..")
const css = () => document.documentElement.style.getPropertyValue("--scene-img")

describe("the Codehouse look", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.removeProperty("--scene-img")
    useStore.setState({ jcPic: "auto", route: "approvals" })
  })
  afterEach(cleanup)

  it("is always on, with no switch to turn it off", async () => {
    expect("jcMode" in useStore.getState()).toBe(false)
    expect("setJcMode" in useStore.getState()).toBe(false)
    render(<SceneBackdrop />)
    await waitFor(() => expect(css()).toContain(autoPictureFor("approvals")))
  })

  it("changes with the screen in automatic", async () => {
    render(<SceneBackdrop />)
    await waitFor(() => expect(css()).toContain(autoPictureFor("approvals")))
    useStore.setState({ route: "sessions" })
    await waitFor(() => expect(css()).toContain("highway"))
  })

  it("uses the picture you chose, and remembers it", async () => {
    useStore.getState().setJcPic("bar")
    render(<SceneBackdrop />)
    await waitFor(() => expect(css()).toContain("bar"))
    expect(css().startsWith('url("http')).toBe(true)
    expect(localStorage.getItem("gatehouse.jcpic")).toBe("bar")
  })

  it("is faint, behind everything, and cannot be clicked", () => {
    const css = readFileSync(join(web, "src", "styles.css"), "utf8")
    const rule = css.slice(css.indexOf('html[data-scene="on"] body::before'))
    expect(rule).toMatch(/z-index:\s*-1/)
    expect(rule).toMatch(/pointer-events:\s*none/)
    const opacity = Number(/opacity:\s*([0-9.]+)/.exec(rule)?.[1])
    expect(opacity).toBeGreaterThan(0)
    expect(opacity).toBeLessThanOrEqual(0.12)
  })

  it("has every picture on disk, and none of the old film stills", () => {
    // Only the drawn scenes and the start-up picture: no photograph, no film still.
    expect(readdirSync(join(web, "public", "codehouse")).sort()).toEqual(["bar.svg", "highway.svg", "lot.svg", "neon-sign.svg", "splash.png"])
    for (const p of BUILTIN_PICTURES)
      expect(existsSync(join(web, "public", p.file)), p.file).toBe(true)
  })
})

describe("the start-up picture", () => {
  const html = readFileSync(join(web, "index.html"), "utf8")
  it("is in index.html, not behind the mode or the theme", () => {
    expect(html).toContain('id="boot"')
    expect(html).toContain("codehouse/neon-sign.svg")
    expect(html).not.toMatch(/data-theme|codehouse="on"/)
  })
  it("is named in the title", () => {
    expect(html).toContain("<title>Codehouse</title>")
  })
})
