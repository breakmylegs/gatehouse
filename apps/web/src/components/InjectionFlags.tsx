import type { SessionInfo } from "@gatehouse/shared/ws-protocol"

/**
 * D-061: results that looked like prompt injection, in a session, with what was found in each. Claude read them with
 * those parts taken out; the session's network commands then ask you, even in Extreme approval, and its web fetches
 * are decided as before (owner, 13 Nov).
 */

const KIND: Record<string, string> = {
  instruction: "instructions aimed at Claude",
  "tool-syntax": "tool-call syntax",
  hidden: "hidden text",
  encoded: "an encoded payload",
}

export function InjectionFlags({ session }: { session: SessionInfo }) {
  const flagged = session.flagged ?? []
  if (!flagged.length) return null
  return (
    <details className="rounded-md border border-warn bg-s1 p-2 text-[13px]" aria-label="Results that looked like prompt injection">
      <summary className="cursor-pointer font-semibold">
        {flagged.length === 1 ? "A result" : `${flagged.length} results`} looked like prompt injection. Claude read{" "}
        {flagged.length === 1 ? "it" : "them"} with those parts taken out. Commands that send over the network (such as
        curl or a push) now ask you, even in Extreme approval; web fetches are decided as before.
      </summary>
      <ul className="m-0 mt-1.5 grid list-none gap-1.5 p-0">
        {flagged.map((f, i) => (
          <li key={`${f.at}-${i}`} className="grid gap-0.5">
            <span>
              <strong>{f.tool}</strong> <span className="text-mut">{new Date(f.at).toLocaleTimeString("en-GB")}</span>
            </span>
            {f.findings.map((x, j) => (
              <span key={j} className="mono break-all text-[12px]">
                <span className="text-mut">{KIND[x.kind] ?? x.kind}: </span>
                {x.sample}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </details>
  )
}
