import { useEffect, useState } from "react"

/**
 * T-101 (t3code review, safe variant): a message you write on the phone is kept as a draft for its session, on the
 * phone only, through a reload or a lost connection. It is never signed or queued while offline: a signed message
 * carries a fresh nonce and lives a minute (invariant 8), so it is signed with Face ID only when you send it online.
 */
const KEY = "codehouse.phone.drafts"
const MAX = 4000

function readAll(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export const readDraft = (sessionId: string) => readAll()[sessionId] ?? ""

export function saveDraft(sessionId: string, text: string): void {
  const all = readAll()
  if (text.trim()) all[sessionId] = text.slice(0, MAX)
  else delete all[sessionId]
  try {
    if (Object.keys(all).length) localStorage.setItem(KEY, JSON.stringify(all))
    else localStorage.removeItem(KEY)
  } catch {
    // storage full or blocked: the draft lasts while the page is open
  }
}

/** Whether the phone is online now, kept up to date. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => {
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
    }
  }, [])
  return online
}
