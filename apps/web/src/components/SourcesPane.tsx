import type { Item } from "../lib/transcript"
import { siteOf, sourcesOf } from "../lib/sources"

/**
 * Where a chat's answers come from (W1-10, ADR 0007): every search result it was shown and every page it read,
 * numbered, each opening in your browser. All of it is from the web and unchecked, and the pane says so.
 */
export function SourcesPane({ items }: { items: Item[] }) {
  const sources = sourcesOf(items)
  return (
    <div className="grid gap-3 p-3">
      <p className="m-0 text-[12.5px] text-mut">
        From the web and not checked by Codehouse: treat what a page says as a claim, not a fact.
        The numbers match Claude's citations. Pages Claude read in full are marked Read.
      </p>
      {sources.length === 0 ? (
        <p className="m-0 text-mut">No sources yet. Ask a question that needs the web.</p>
      ) : (
        <ol className="m-0 grid list-none gap-2 p-0" aria-label="Sources">
          {sources.map((s) => (
            <li key={s.url} className="source-row">
              <span className="source-n">{s.n}</span>
              <span className="grid min-w-0">
                <a href={s.url} target="_blank" rel="noreferrer" className="truncate font-semibold">
                  {s.title}
                </a>
                <span className="truncate text-[12px] text-mut">
                  {siteOf(s.url)}
                  {s.read ? " · Read" : ""} · from the web, untrusted
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
