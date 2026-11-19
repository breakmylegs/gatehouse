import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { effective, eventKeys, SHORTCUTS } from "../lib/shortcuts"
import { SHORTCUTS_CHANGED } from "../lib/useShortcuts"

/**
 * T-071: Settings, Keyboard shortcuts: give a command your own keys by pressing them in its box, or none, or back to
 * the default. The keys that decide a request and the kill switch cannot be given to anything; a key used twice is
 * refused; each refusal says why.
 */
export function ShortcutSettings() {
  const [own, setOwn] = useState<Record<string, string>>({})
  useEffect(() => {
    void api<{ running?: { shortcuts?: Record<string, string> } }>("GET", "/api/settings").then((r) => r.ok && r.data && setOwn(r.data.running?.shortcuts ?? {}))
  }, [])
  const { keys, refused } = effective(own)
  const save = async (next: Record<string, string>) => {
    const check = effective(next)
    const bad = check.refused.find((x) => x.id in next && !(x.id in own && own[x.id] === next[x.id]))
    if (bad) return void toast.error(`${SHORTCUTS.find((s) => s.id === bad.id)?.label}: ${bad.why}.`, { id: "keys" })
    const r = await api<{ shortcuts: Record<string, string> }>("PUT", "/api/shortcuts", { shortcuts: next })
    if (!r.ok || !r.data) return void toast.error(r.error ?? "Not saved", { id: "keys" })
    setOwn(r.data.shortcuts)
    window.dispatchEvent(new Event(SHORTCUTS_CHANGED))
    toast.success("Keyboard shortcuts saved", { id: "keys" })
  }
  return (
    <div className="grid gap-2 text-[13px]">
      <table className="w-full border-collapse">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.id} className="border-t border-line">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {s.label}
              </th>
              <td className="py-1">
                <input
                  className="field mono w-44"
                  aria-label={`Keys for ${s.label}`}
                  readOnly
                  value={keys[s.id] ?? "none"}
                  onKeyDown={(e) => {
                    if (e.key === "Tab") return
                    e.preventDefault()
                    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return
                    void save({ ...own, [s.id]: eventKeys(e.nativeEvent) })
                  }}
                />
              </td>
              <td className="py-1">
                <span className="flex gap-1">
                  <button type="button" className="btn !min-h-7" onClick={() => void save({ ...own, [s.id]: "" })}>
                    None
                  </button>
                  {s.id in own ? (
                    <button
                      type="button"
                      className="btn !min-h-7"
                      onClick={() => {
                        const { [s.id]: _gone, ...rest } = own
                        void save(rest)
                      }}
                    >
                      Default ({s.keys})
                    </button>
                  ) : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {refused.length ? (
        <ul className="m-0 grid gap-0.5 pl-5 text-warn">
          {refused.map((x) => (
            <li key={x.id}>
              {SHORTCUTS.find((s) => s.id === x.id)?.label}: {x.why}.
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-mut">Press the keys in a box to give them to that command. Ctrl+Enter, the hold on a High request, typed allow for Severe and the kill switch (Ctrl+Shift+K) are never given to anything else.</p>
    </div>
  )
}
