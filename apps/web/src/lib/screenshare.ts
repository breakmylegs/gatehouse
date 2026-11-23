/**
 * E-091, screen-share safe mode. Switched by Ctrl+Shift+H, the tray or the session menu, and kept across a restart so
 * a share is not exposed by one. While it is on: every word on your redaction list is masked wherever the window
 * shows it (the transcript included; what you type is left alone); the sessions you chose are hidden; notices that are
 * not urgent (a turn finished, the queue empty) are held, and told as one when the mode ends, while requests for a
 * decision still come; pairing codes and push topics are hidden; and the window app keeps the quick prompt and the
 * pop-out windows out of screen captures (WDA_EXCLUDEFROMCAPTURE).
 */
const ON = "codeh:screenshare"
const HIDDEN = "codeh:screenshare-hidden"
export const MASK = "•••"

const listeners = new Set<() => void>()
const read = (k: string) => {
  try {
    return globalThis.localStorage?.getItem(k) ?? null
  } catch {
    return null
  }
}
const write = (k: string, v: string | null) => {
  try {
    if (v === null) globalThis.localStorage?.removeItem(k)
    else globalThis.localStorage?.setItem(k, v)
  } catch {
    /* private mode */
  }
}

export const screenShareOn = () => read(ON) === "1"

export function setScreenShare(on: boolean): void {
  write(ON, on ? "1" : null)
  for (const l of listeners) l()
}

export function hiddenSessions(): Set<string> {
  try {
    return new Set(JSON.parse(read(HIDDEN) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}

export function setHidden(sessionId: string, hide: boolean): void {
  const s = hiddenSessions()
  if (hide) s.add(sessionId)
  else s.delete(sessionId)
  write(HIDDEN, JSON.stringify([...s]))
  for (const l of listeners) l()
}

/** Whether a session's transcript is hidden now. */
export const isHidden = (sessionId: string) => screenShareOn() && hiddenSessions().has(sessionId)

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

// ---- notices held while sharing ----

let held: string[] = []

/** True when the notice must wait: the mode is on and it is not urgent. Requests for a decision are always urgent. */
export function holdNotice(what: string, urgent = false): boolean {
  if (urgent || !screenShareOn()) return false
  held.push(what)
  return true
}

/** The notices held, emptied. */
export function releaseHeld(): string[] {
  const out = held
  held = []
  return out
}

// ---- masking on screen ----

const SKIP = new Set(["INPUT", "TEXTAREA", "SCRIPT", "STYLE", "NOSCRIPT"])
const original = new WeakMap<Text, string>()

function termPattern(terms: string[]): RegExp | undefined {
  const t = [...new Set(terms.map((x) => x.trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length)
  return t.length ? new RegExp(t.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi") : undefined
}

function skipped(n: Node): boolean {
  for (let p = n.parentElement; p; p = p.parentElement) if (SKIP.has(p.tagName) || p.isContentEditable || p.hasAttribute("data-no-mask")) return true
  return false
}

/** Masks the terms in every text node under root; keeps what each said so it can be put back. */
export function maskTerms(root: Node, terms: string[]): number {
  const re = termPattern(terms)
  if (!re) return 0
  let n = 0
  const walk = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const nodes: Text[] = []
  for (let t = walk.nextNode(); t; t = walk.nextNode()) nodes.push(t as Text)
  for (const t of nodes) {
    const v = t.nodeValue ?? ""
    if (!v || skipped(t)) continue
    re.lastIndex = 0
    if (!re.test(v)) continue
    re.lastIndex = 0
    if (!original.has(t)) original.set(t, v)
    t.nodeValue = v.replace(re, MASK)
    n++
  }
  return n
}

/** Puts back what masking changed under root. */
export function unmask(root: Node): void {
  const walk = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, 4)
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const v = original.get(t as Text)
    if (v !== undefined && (t as Text).nodeValue?.includes(MASK)) (t as Text).nodeValue = v
    original.delete(t as Text)
  }
}

/** Keeps masking as the window changes; returns how to stop (and put everything back). */
export function watchAndMask(root: HTMLElement, terms: string[]): () => void {
  maskTerms(root, terms)
  let busy = false
  const obs = new MutationObserver(() => {
    if (busy) return
    busy = true
    try {
      maskTerms(root, terms)
    } finally {
      busy = false
    }
  })
  obs.observe(root, { subtree: true, childList: true, characterData: true })
  return () => {
    obs.disconnect()
    unmask(root)
  }
}
