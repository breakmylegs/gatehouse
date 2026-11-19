// @vitest-environment jsdom
// T-052: maths in messages. Plain maths in single dollars, \( \) and \[ \] is read as maths and money is not; code is
// never changed; a reply draws maths with KaTeX, trusting nothing in it, and shows the source of maths it cannot read.
import { cleanup, render } from "@testing-library/react"
import Markdown from "react-markdown"
import { afterEach, describe, expect, it } from "vitest"
import { renderMath } from "../src/components/MathView"
import { mathText } from "../src/lib/math-text"
import { MARKDOWN_PARTS, REPLY_PLUGINS } from "../src/surfaces/Workspace"

afterEach(cleanup)
const draw = (md: string) => render(<Markdown remarkPlugins={REPLY_PLUGINS} components={MARKDOWN_PARTS}>{mathText(md)}</Markdown>).container

describe("maths in messages (T-052)", () => {
  it("reads plain maths as maths and leaves money, code and prose alone", () => {
    expect(mathText("Area is $\\pi r^2$ here")).toBe("Area is $$\\pi r^2$$ here")
    expect(mathText("Use \\(a_1 + b_1\\) and $x = 2$")).toBe("Use $$a_1 + b_1$$ and $$x = 2$$")
    expect(mathText("It costs $5 to $10, or $ 3 $.")).toBe("It costs $5 to $10, or $ 3 $.")
    expect(mathText("Run `echo $x_1$` then")).toBe("Run `echo $x_1$` then")
    expect(mathText("```sh\nexport A=$b_1$\n```")).toBe("```sh\nexport A=$b_1$\n```")
    expect(mathText("\\[ e^{i\\pi} + 1 = 0 \\]")).toBe("$$\ne^{i\\pi} + 1 = 0\n$$")
    expect(mathText("\\[\nx^2\n\\]")).toBe("$$\nx^2\n$$")
  })

  it("draws inline and block maths in a reply, and keeps prices as text", () => {
    const c = draw("Euler: $e^{i\\pi} + 1 = 0$, which costs $5 to $10.\n\n$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2}\n$$\n\n```math\nx^2\n```")
    expect(c.querySelectorAll(".math-inline .katex")).toHaveLength(1)
    expect(c.querySelectorAll(".math-display .katex-display")).toHaveLength(2)
    expect(c.textContent).toContain("which costs $5 to $10.")
    // Ordinary code is still code.
    const k = draw("Run `npm test`.")
    expect(k.querySelector("code")?.textContent).toBe("npm test")
    expect(k.querySelector(".katex")).toBeNull()
  })

  it("trusts nothing in the maths, and shows the source when it cannot be read", () => {
    // Refused, and shown as unknown: no link and no address anywhere in what is drawn.
    const html = renderMath("\\href{javascript:alert(1)}{x}", false) ?? ""
    expect(html).not.toMatch(/<a\b|href=/)
    const c0 = draw("$$\\href{javascript:alert(1)}{x}$$")
    expect(c0.querySelector("a, [href]")).toBeNull()
    expect(renderMath("\\frac{1}{", false)).toBeUndefined()
    const c = draw("Broken: $$\\frac{1}{$$")
    expect(c.querySelector("code")?.textContent).toBe("\\frac{1}{")
  })
})
