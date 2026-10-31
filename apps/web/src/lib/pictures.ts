import { useEffect, useMemo, useState } from "react"
import { api } from "./api"
import type { Picture } from "./transcript"

/**
 * A session folder's preview address, asked for once per session. Its pictures load through it like the preview
 * pane's pages: only inside that folder, never a file the policy floor blocks (files-api.ts).
 */
const bases = new Map<string, Promise<string | undefined>>()

export function previewBase(sessionId: string): Promise<string | undefined> {
  let p = bases.get(sessionId)
  if (!p) {
    p = api<{ base: string }>("POST", "/api/files/preview", { session: sessionId }).then((r) =>
      r.ok && typeof r.data?.base === "string" ? r.data.base : undefined,
    )
    bases.set(sessionId, p)
    // Asked again next time, rather than remembering that it failed.
    void p.then((b) => {
      if (!b) bases.delete(sessionId)
    })
  }
  return p
}

/** After JCVC restarts the old address has gone: the next picture asks for a new one. */
export const forgetPreview = (sessionId: string) => bases.delete(sessionId)

export const pictureUrl = (base: string, rel: string) =>
  base + rel.split("/").map(encodeURIComponent).join("/")

/** The pictures with an address each: one known by its place in the folder gets the folder's preview address. */
export function usePictures(
  sessionId: string | undefined,
  images: Picture[] | undefined,
): { shown: Picture[]; retry: () => void } {
  const needs = Boolean(sessionId && images?.some((i) => !i.url && i.path))
  const [base, setBase] = useState<string>()
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (!needs || !sessionId) return
    let gone = false
    void previewBase(sessionId).then((b) => {
      if (!gone) setBase(b)
    })
    return () => {
      gone = true
    }
  }, [needs, sessionId, tries])
  const shown = useMemo(
    () =>
      (images ?? []).map((i) =>
        i.url || !i.path || !base ? i : { ...i, url: pictureUrl(base, i.path) },
      ),
    [images, base],
  )
  return {
    shown,
    /** A picture that would not load: once, ask for a new address and try again. */
    retry: () => {
      if (!sessionId || tries > 0) return
      forgetPreview(sessionId)
      setBase(undefined)
      setTries(1)
    },
  }
}
