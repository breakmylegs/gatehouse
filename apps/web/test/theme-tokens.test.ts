// The look's tokens, read from styles.css: no orange accent, no warm cream ground, every text pair at WCAG AA
// (interface research U15, ADR 0002). Owner's rule: do not copy Claude desktop or claude.ai.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const whole = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8")
const forcedAt = whole.indexOf("@media (forced-colors: active)")
// The palette is what comes before the high-contrast block, which swaps every token for a system colour.
const css = forcedAt < 0 ? whole : whole.slice(0, forcedAt)

/** The custom properties declared in every block that opens with this selector, later ones winning. */
function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  let at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no ${selector} block`)
  while (at >= 0) {
    const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at))
    for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim()
    at = css.indexOf(`${selector} {`, at + 1)
  }
  return out
}
const light = tokens(":root")
const dark = { ...light, ...tokens(':root[data-theme="dark"]') }

type Oklch = { l: number; c: number; h: number }
function parse(v: string): Oklch {
  const o = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(v)
  if (o) return { l: Number(o[1]) / 100, c: Number(o[2]), h: Number(o[3]) }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
  if (!hex) throw new Error(`cannot read colour ${v}`)
  const h = hex[1]!.length === 3 ? [...hex[1]!].map((x) => x + x).join("") : hex[1]!
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  return fromLinear(lin(r), lin(g), lin(b))
}
const lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4)
function fromLinear(r: number, g: number, b: number): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 }
}
/** Relative luminance (WCAG) of an OKLCH colour, through linear sRGB, clipped to the gamut. */
function luminance({ l, c, h }: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (x: number) => Math.min(1, Math.max(0, x))
  const r = clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)
  const g = clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)
  const bl = clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(parse(fg)), luminance(parse(bg))]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const themes = { light, dark }

describe("the colour maths", () => {
  it("agrees with the known contrast of black on white and of a mid grey", () => {
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 0)
    expect(contrast("#767676", "#fff")).toBeCloseTo(4.54, 1)
  })
})

describe.each(Object.entries(themes))("%s theme tokens", (_name, t) => {
  it("has no accent in the orange family (hue 15 to 75 degrees)", () => {
    for (const key of ["--c-acc", "--c-viz"]) {
      const { h, c } = parse(t[key]!)
      expect(c > 0.02 && h >= 15 && h <= 75, `${key} is orange (hue ${h.toFixed(0)})`).toBe(false)
    }
  })

  it("has no warm cream ground", () => {
    for (const key of ["--c-bg", "--c-s1", "--c-s2", "--c-shell"]) {
      const { l, c, h } = parse(t[key]!)
      expect(l > 0.85 && c > 0.02 && h >= 55 && h <= 110, `${key} is cream`).toBe(false)
    }
  })

  const pairs: Array<[string, string, number]> = [
    ["--c-tx", "--c-bg", 4.5],
    ["--c-tx", "--c-s1", 4.5],
    ["--c-tx", "--c-s2", 4.5],
    ["--c-mut", "--c-bg", 4.5],
    ["--c-mut", "--c-s1", 4.5],
    ["--c-mut", "--c-s2", 4.5],
    ["--c-acc", "--c-bg", 4.5],
    ["--c-acc", "--c-s1", 4.5],
    ["--c-acc-tx", "--c-acc", 4.5],
    ["--c-sev", "--c-bg", 4.5],
    ["--c-sev", "--c-s1", 4.5],
    ["--c-ok", "--c-bg", 4.5],
    ["--c-ok", "--c-s1", 4.5],
    ["--c-warn", "--c-bg", 4.5],
    ["--c-warn", "--c-s1", 4.5],
    ["--c-sign-tx", "--c-sign", 4.5],
    ["--c-shell-tx", "--c-shell", 4.5],
    ["--c-shell-tx", "--c-shell-2", 4.5],
    ["--c-shell-mut", "--c-shell", 4.5],
    ["--c-shell-mut", "--c-shell-2", 4.5],
  ]
  it.each(pairs)("%s on %s meets WCAG AA (%d:1)", (fg, bg, min) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min)
  })
})

describe("Windows high contrast", () => {
  const block = forcedAt < 0 ? "" : whole.slice(forcedAt)

  it("has rules, and replaces every colour token with a system colour", () => {
    expect(block).not.toBe("")
    for (const key of Object.keys(light).filter((k) => k.startsWith("--c-"))) {
      expect(block, `${key} is not mapped in forced colours`).toMatch(
        new RegExp(`${key}:\\s*(Canvas|CanvasText|LinkText|Highlight|HighlightText)\\b`),
      )
    }
    expect(block).not.toMatch(/oklch\(|#[0-9a-f]{3,6}\b/i)
  })

  it("keeps a visible outline for focus and for the current item", () => {
    expect(block).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight/)
    expect(block).toMatch(/\[aria-current="page"\][^{]*\{[^}]*outline/)
  })
})
