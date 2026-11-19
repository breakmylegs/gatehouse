/**
 * T-071: customisable shortcuts. A registry of the commands a key can start, each with its default; your own keys
 * are kept in Codehouse's settings (`shortcuts`: command id to keys) and read tolerantly, so a command this version
 * does not know is left alone and a command added later starts with its default. Yours come first; a default yields
 * to a key you gave another command. The keys that decide a request (Ctrl+Enter to allow, the hold on a High request,
 * typed allow for Severe) and the kill switch can never be given to anything (D-092, U4), and a key cannot be used twice.
 */
export interface Shortcut {
  id: string
  label: string
  keys: string
  /** Not while you are typing in a text box. */
  notInText?: boolean
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "palette", label: "Search and commands", keys: "Ctrl+K" },
  { id: "shortcuts", label: "Keyboard shortcuts", keys: "Ctrl+/" },
  { id: "sidebar", label: "Hide or show the sidebar", keys: "Ctrl+B" },
  { id: "copy-reply", label: "A conversation: copy Claude's last reply", keys: "Ctrl+Shift+C" },
  { id: "copy-code", label: "A conversation: copy the last code block", keys: "Ctrl+Shift+;" },
  { id: "help", label: "Help for this page", keys: "F1" },
]

/** Never given to a command: they decide requests, or stop everything. */
export const LOCKED_KEYS: ReadonlySet<string> = new Set(["Ctrl+Enter", "Ctrl+Shift+K", "Enter", "Escape", "Tab", "Shift+Tab"])

const MODS = ["Ctrl", "Alt", "Shift"] as const
const NAMED = new Set(["Enter", "Escape", "Tab", "Space", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)])

/** Keys in one written form ("Ctrl+Shift+P"), or undefined for something that is not a key. */
export function normalise(keys: string): string | undefined {
  const parts = keys.split("+").map((p) => p.trim()).filter(Boolean)
  if (!parts.length || parts.length > 4) return undefined
  const key = parts.pop()!
  const mods = new Set<string>()
  for (const m of parts) {
    const c = m.toLowerCase() === "cmd" || m.toLowerCase() === "meta" || m.toLowerCase() === "control" ? "Ctrl" : m[0]!.toUpperCase() + m.slice(1).toLowerCase()
    if (!(MODS as readonly string[]).includes(c)) return undefined
    mods.add(c)
  }
  const k = key.length === 1 ? key.toUpperCase() : NAMED.has(key) ? key : [...NAMED].find((n) => n.toLowerCase() === key.toLowerCase())
  if (!k) return undefined
  // A single letter or digit alone would fire while typing: it needs Ctrl or Alt.
  if (k.length === 1 && !mods.has("Ctrl") && !mods.has("Alt")) return undefined
  return [...MODS.filter((m) => mods.has(m)), k].join("+")
}

/** The key a physical key is, whatever Shift does to it on this layout: KeyK is K, Semicolon is ; and Digit1 is 1. */
const CODES: Record<string, string> = { Semicolon: ";", Slash: "/", Comma: ",", Period: ".", Quote: "'", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`", Backslash: "\\" }
function keyOfCode(code: string | undefined): string | undefined {
  if (!code) return undefined
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code)
  return m ? (m[1] ?? m[2]) : CODES[code]
}

/** The keys a keyboard event is, in the same form. */
export function eventKeys(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & { code?: string }): string {
  const k = keyOfCode(e.code) ?? (e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : "", k].filter(Boolean).join("+")
}

/**
 * The keys in force for each command: your own where valid, free and not locked, else the default unless one of yours
 * took it. Also what was refused, and why.
 */
export function effective(own: Record<string, unknown> | undefined): { keys: Record<string, string | undefined>; refused: Array<{ id: string; why: string }> } {
  const refused: Array<{ id: string; why: string }> = []
  const mine = new Map<string, string>()
  const taken = new Set<string>()
  for (const s of SHORTCUTS) {
    const raw = own?.[s.id]
    if (raw === undefined) continue
    if (raw === "" || raw === null) {
      mine.set(s.id, "")
      continue
    }
    const k = typeof raw === "string" ? normalise(raw) : undefined
    if (!k) refused.push({ id: s.id, why: "not a key Codehouse can use" })
    else if (LOCKED_KEYS.has(k)) refused.push({ id: s.id, why: `${k} decides requests or stops everything, so it is never given to anything else` })
    else if (taken.has(k)) refused.push({ id: s.id, why: `${k} is already given to another command` })
    else {
      mine.set(s.id, k)
      taken.add(k)
    }
  }
  const keys: Record<string, string | undefined> = {}
  for (const s of SHORTCUTS) {
    const m = mine.get(s.id)
    if (m !== undefined) keys[s.id] = m || undefined
    else keys[s.id] = taken.has(s.keys) ? undefined : s.keys
  }
  return { keys, refused }
}

/** The command a key starts, or undefined. Not while typing for one that says so. */
export function commandFor(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & { code?: string }, keys: Record<string, string | undefined>, inText = false): string | undefined {
  const k = eventKeys(e)
  const s = SHORTCUTS.find((x) => keys[x.id] === k)
  return s && !(inText && s.notInText) ? s.id : undefined
}
