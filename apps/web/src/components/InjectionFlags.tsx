import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { useStore } from "../store"

/**
 * D-061: results that looked like prompt injection, in a session, with what was found in each. Claude read them with
 * those parts taken out. O58 (owner, 27 Nov): with "Hold network commands after a prompt-injection flag" on, the
 * session's network commands then ask you, except in Max approval, which answers them (invariant 3, 14 Nov); off, as it
 * is unless switched on, nothing is held for a flag. Web fetches are decided as before either way.
 */

const KIND: Record<string, string> = {
  instruction: "instructions aimed at Claude",
  "tool-syntax": "tool-call syntax",
  hidden: "hidden text",
  encoded: "an encoded payload",
}

export function InjectionFlags({ session }: { session: SessionInfo }) {
  const flagged = session.flagged ?? []
  const holds = useStore((s) => s.health?.holdNetworkAfterInjection === true)
  if (!flagged.length) return null
  return (
    <details className="rounded-md border border-warn bg-s1 p-2 text-[13px]" aria-label="Results that looked like prompt injection">
      <summary className="cursor-pointer font-semibold">
        {flagged.length === 1 ? "A result" : `${flagged.length} results`} looked like prompt injection. Claude read{" "}
        {flagged.length === 1 ? "it" : "them"} with those parts taken out.{" "}
        {holds
          ? "Commands that send over the network (such as curl or a push) now ask you, except in Max approval, which answers them."
          : "Nothing is held for it: network commands run as your rules and mode decide."}
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
