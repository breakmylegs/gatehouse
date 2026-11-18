import type { ComponentProps } from "react"

/** A link that leaves Codehouse: a web page or an email address, not a place inside the interface. */
export const LEAVES = /^(https?:|mailto:)/i

/**
 * Owner, 18 Nov: a link in a chat, an artifact or any Markdown opens in a new window (the browser, through the
 * window's NewWindowRequested, or a new tab in CNW's /app), never in Codehouse's own page, which it would navigate
 * away from. The window's guard stays the safety net. A link inside the interface is left as it is.
 */
export function outward(href: string | undefined): Pick<ComponentProps<"a">, "target" | "rel"> {
  return typeof href === "string" && LEAVES.test(href.trim()) ? { target: "_blank", rel: "noopener noreferrer" } : {}
}

/** The `a` that react-markdown draws, opening outward. */
export function OutLink({ node: _node, href, children, ...rest }: ComponentProps<"a"> & { node?: unknown }) {
  return (
    <a {...rest} href={href} {...outward(href)}>
      {children}
    </a>
  )
}

/** For `<Markdown components={LINK_PARTS}>`. */
export const LINK_PARTS = { a: OutLink }
