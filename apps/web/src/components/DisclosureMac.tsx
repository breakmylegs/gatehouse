/**
 * Mac fork: a disclosure chevron, drawn as the Mac's own sidebars draw it, in the icon set's stroke. Owner, 25 Nov: the
 * Mac's style on Windows too, so on every platform; `mac={false}` still draws upstream's text arrow, for a caller that
 * wants it. Rail.tsx and CommandDeck.tsx use it (see docs/mac.md).
 */
export function Disclosure({ open, mac = true }: { open: boolean; mac?: boolean }) {
  if (!mac) return <span aria-hidden="true">{open ? "▾" : "▸"}</span>
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      width="10"
      height="10"
      className="inline-block align-[0px]"
      style={{
        transform: open ? "rotate(90deg)" : undefined,
        transition: "transform 160ms cubic-bezier(0.23, 1, 0.32, 1)",
      }}
    >
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
