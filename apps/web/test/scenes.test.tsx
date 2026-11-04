// @vitest-environment jsdom
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const web = join(__dirname, "..")

describe("the Codehouse look", () => {
  it("has no faint picture behind the screens (owner, 4 Nov: it made the app look less clean)", () => {
    const css = readFileSync(join(web, "src", "styles.css"), "utf8")
    expect(css).not.toMatch(/data-scene|--scene-img|body::before/)
    const app = readFileSync(join(web, "src", "App.tsx"), "utf8")
    expect(app).not.toMatch(/SceneBackdrop|dataset\.scene/)
  })

  it("has every picture on disk, all from the Codehouse visual identity pack", () => {
    // Only the pack's files: its icons, spot pictures, wordmarks, start-up picture and the start screen the owner made
    // with ChatGPT. No film still, and no background scenes.
    expect(readdirSync(join(web, "public", "codehouse")).sort()).toEqual([
      "brand",
      "empty",
      "icons.svg",
      "splash.png",
      "start-screen.png",
    ])
  })
})

describe("the start-up picture", () => {
  const html = readFileSync(join(web, "index.html"), "utf8")
  it("is in index.html, not behind the mode or the theme", () => {
    expect(html).toContain('id="boot"')
    expect(html).toContain("codehouse/start-screen.png")
    expect(existsSync(join(web, "public", "codehouse", "start-screen.png"))).toBe(true)
    expect(html).not.toMatch(/data-theme|codehouse="on"/)
  })
  it("is named in the title, with the pack's mark as the page icon", () => {
    expect(html).toContain("<title>Codehouse</title>")
    expect(html).toContain('href="./favicon.svg"')
    expect(existsSync(join(web, "public", "favicon.svg"))).toBe(true)
  })
})
