import katex from "katex"
import "katex/dist/katex.min.css"
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { isValidElement } from "react"

/**
 * T-052: maths drawn with KaTeX. It never trusts what it draws (no \href, \url, \includegraphics or HTML), keeps its
 * expansion and size small, and shows the source as code when it cannot be read rather than failing.
 */
export function renderMath(tex: string, display: boolean): string | undefined {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: "ignore", maxSize: 20, maxExpand: 500, output: "htmlAndMathml" })
  } catch {
    return undefined
  }
}

export function MathView({ tex, display }: { tex: string; display: boolean }) {
  const html = renderMath(tex, display)
  if (html === undefined) return display ? <pre><code>{tex}</code></pre> : <code>{tex}</code>
  return display ? (
    <div className="math-display overflow-x-auto py-1" role="math" aria-label={tex} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span className="math-inline" role="math" aria-label={tex} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

const textOf = (n: ReactNode): string => (typeof n === "string" ? n : Array.isArray(n) ? n.map(textOf).join("") : isValidElement(n) ? textOf((n.props as { children?: ReactNode }).children) : "")
const classOf = (n: ReactNode) => (isValidElement(n) ? String((n.props as { className?: string }).className ?? "") : "")

/** remark-math's inline maths arrives as code with the math-inline class. */
export function mathCode(props: ComponentProps<"code"> & { node?: unknown }): ReactElement {
  const { node: _node, ...rest } = props
  const cls = String(rest.className ?? "")
  if (/\bmath-inline\b/.test(cls)) return <MathView tex={textOf(rest.children)} display={false} />
  return <code {...rest} />
}

/** Its block maths, and a ```math block, arrive as pre > code; anything else is drawn by `fallback`. */
export function mathPre(fallback: (p: ComponentProps<"pre">) => ReactElement) {
  return function Pre(props: ComponentProps<"pre">): ReactElement {
    const child = Array.isArray(props.children) ? props.children[0] : props.children
    if (/\b(math-display|language-math)\b/.test(classOf(child))) return <MathView tex={textOf(child).replace(/\n$/, "")} display />
    return fallback(props)
  }
}
