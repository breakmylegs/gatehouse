import { createContext, useEffect, useRef } from "react"
import type { Item } from "./transcript"

/**
 * Settings, Sessions, Viewer (owner's Settings overhaul, from Claude desktop's Browser settings): a page or picture
 * Claude writes opens in the pane's viewer by itself, and a link to a page on this computer opens there instead of in
 * your browser. Kept in this window, like Appearance. Pages from the internet never open inside Codehouse.
 */
export interface ViewerPrefs {
  /** Open a page or picture Claude writes. On unless turned off. */
  autoOpen: boolean
  /** Open a link to localhost or 127.0.0.1 in the viewer. On unless turned off. */
  localLinks: boolean
}

const KEY = "gatehouse.viewer"

export function readViewerPrefs(): ViewerPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ViewerPrefs>
    return { autoOpen: v.autoOpen !== false, localLinks: v.localLinks !== false }
  } catch {
    return { autoOpen: true, localLinks: true }
  }
}

export function saveViewerPrefs(p: ViewerPrefs): void {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>
    localStorage.setItem(KEY, JSON.stringify({ ...kept, ...p }))
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
}

/** A page on this computer: the only kind the viewer opens. */
export const LOCAL_PAGE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/|$)/i

/** What the viewer can show of a file Claude writes: a web page or a picture. */
export const VIEWABLE = /\.(html?|png|jpe?g|gif|webp|svg)$/i

/** Lets a link in Claude's words open a page on this computer in its pane's viewer. */
export const OpenLocalPage = createContext<((url: string) => void) | undefined>(undefined)

/**
 * Calls `open` with each page or picture Claude writes from now on, once each. A file written before the pane
 * opened, or before it showed this session (`key`), is not opened.
 */
export function useOpenWhatClaudeWrites(
  key: string | undefined,
  items: Item[] | undefined,
  open: (file: string) => void,
  on: boolean,
): void {
  const seen = useRef<Set<string> | undefined>(undefined)
  const seenFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (seenFor.current !== key) {
      seenFor.current = key
      seen.current = undefined
    }
    const done = (items ?? []).filter(
      (i): i is Extract<Item, { kind: "tool" }> =>
        i.kind === "tool" && i.name === "Write" && i.result !== undefined && !i.result.isError,
    )
    if (!seen.current) {
      seen.current = new Set(done.map((t) => t.toolUseId))
      return
    }
    const fresh = done.filter((t) => !seen.current!.has(t.toolUseId))
    for (const t of fresh) seen.current.add(t.toolUseId)
    if (!on) return
    const last = fresh
      .map((t) => t.input.file_path)
      .filter((p): p is string => typeof p === "string" && VIEWABLE.test(p))
      .at(-1)
    if (last) open(last)
  }, [key, items, open, on])
}
