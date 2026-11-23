import { toast } from "sonner"
import type { Item } from "../lib/transcript"
import { siteOf, sourcesOf } from "../lib/sources"
import { briefPrompt, checkBrief, fixPrompt, latestBrief } from "../lib/brief"
import { send } from "../store"

/**
 * Where a chat's answers come from (W1-10, ADR 0007): every search result it was shown and every page it read,
 * numbered, each opening in your browser. All of it is from the web and unchecked, and the pane says so.
 */
export function SourcesPane({ items, sessionId }: { items: Item[]; sessionId?: string }) {
  const sources = sourcesOf(items)
  // E-087: a decision brief from the research, each option citing these sources; the latest one is checked.
  const brief = latestBrief(items)
  const check = brief ? checkBrief(brief, sources) : undefined
  const ask = (text: string) =>
    sessionId ? void send({ type: "prompt", sessionId, text }).then((x) => (x.ok ? undefined : toast.error(x.error?.message ?? "Not sent", { id: "brief" }))) : undefined
  return (
    <div className="grid gap-3 p-3">
      {sessionId && sources.length ? (
        <div className="grid gap-1.5">
          <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => ask(briefPrompt(sources))}>
            Draft a decision brief from these sources
          </button>
          {check ? (
            check.ok ? (
              <p className="m-0 text-[12.5px]" role="status">
                The latest brief: every option ({check.options.length}) cites a source from this pane.
              </p>
            ) : (
              <div className="grid gap-1 text-[12.5px]" role="status">
                <span className="font-semibold">The latest brief needs fixing:</span>
                <ul className="m-0 pl-5">
                  {check.missingSections.map((s) => (
                    <li key={s}>No {s} section</li>
                  ))}
                  {check.options
                    .filter((o) => !o.ok || o.unknown.length)
                    .map((o) => (
                      <li key={o.name}>
                        {o.name}: {o.ok ? "" : "no source from this pane"}
                        {o.unknown.length ? `${o.ok ? "" : "; "}cites ${o.unknown.map((n) => `[${n}]`).join(", ")}, not in this pane` : ""}
                      </li>
                    ))}
                </ul>
                <button type="button" className="btn !min-h-7 justify-self-start" onClick={() => ask(fixPrompt(check))}>
                  Ask Claude to fix it
                </button>
              </div>
            )
          ) : null}
        </div>
      ) : null}
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
