import type { PrLink } from "../lib/prLinks"

/**
 * T-078: the pull requests a session opened, from its own gh pr create. Owner, 16 Nov ("These # numbers in the title are
 * annoying"): one small button beside the session's name that opens the list, newest first, not a link each under it.
 */
export function PrLinksMenu({ prs }: { prs: readonly PrLink[] }) {
  if (!prs.length) return null
  return (
    <details className="pr-links relative text-xs">
      <summary className="cursor-pointer select-none font-semibold text-mut">
        {prs.length === 1 ? "Pull request" : `Pull requests (${prs.length})`}
      </summary>
      <span
        role="group"
        aria-label="Pull requests this session opened"
        className="absolute left-0 z-20 mt-1 grid max-h-64 min-w-48 gap-1 overflow-auto rounded border border-line bg-panel p-2 shadow"
      >
        {[...prs].reverse().map((p) => (
          <a key={p.url} href={p.url} target="_blank" rel="noreferrer" title={p.url}>
            {p.repo.split("/")[1]} #{p.number}
          </a>
        ))}
      </span>
    </details>
  )
}
