import { useEffect, useState } from "react"
import { api } from "../lib/api"
import { useStore } from "../store"

/** Told when an import finishes, so the list shows what came in. */
export const IMPORTED_EVENT = "codeh:imported"

/**
 * From claude.ai (the owner's Chat build, CH-05): imported chats in the Chat side of the sidebar, newest first, each
 * opening its read-only copy. Nothing shows until something has been imported.
 */
export function ImportedChats() {
  const [list, setList] = useState<Array<{ id: string; title: string }>>([])
  const open = useStore((s) => s.openImported)
  const current = useStore((s) => (s.route === "imported" ? s.importedChat : undefined))
  useEffect(() => {
    const load = () =>
      void api<{ conversations: Array<{ id: string; title: string }> }>(
        "GET",
        "/api/chat/conversations?kind=imported&limit=200",
      ).then((r) => {
        if (r.ok && r.data) setList(r.data.conversations)
      })
    load()
    window.addEventListener(IMPORTED_EVENT, load)
    return () => window.removeEventListener(IMPORTED_EVENT, load)
  }, [])
  if (!list.length) return null
  return (
    <section aria-label="Chats from claude.ai" className="mb-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="sign text-[13px] font-semibold text-shell-mut">From claude.ai</span>
        <span className="text-[12px] text-shell-mut">{list.length}</span>
      </div>
      <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
        {list.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="rail-item w-full truncate text-left"
              aria-current={current === c.id ? "page" : undefined}
              onClick={() => open(c.id)}
            >
              <span className="truncate">{c.title || "Untitled chat"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
