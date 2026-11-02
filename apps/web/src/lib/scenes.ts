import type { Route } from "../store"

/**
 * The pictures that come with the app, for the Codehouse look: original roadhouse scenes drawn for it (owner, 2 Nov:
 * royalty-free, nothing taken from any film). A choice saved for a picture that has gone falls back to the first.
 */
export const BUILTIN_PICTURES = [
  { id: "neon", label: "The sign at night", file: "codehouse/neon-sign.svg" },
  { id: "highway", label: "The highway at dusk", file: "codehouse/highway.svg" },
  { id: "bar", label: "Inside the bar", file: "codehouse/bar.svg" },
  { id: "lot", label: "The parking lot", file: "codehouse/lot.svg" },
] as const

export type PictureChoice = "auto" | string

/** In "auto", each screen gets its own picture, so the background changes as you move around. */
const AUTO: Partial<Record<Route, string>> = {
  approvals: "neon",
  sessions: "highway",
  workspace: "bar",
  policy: "lot",
  audit: "highway",
  devices: "bar",
  settings: "neon",
  setup: "lot",
  "first-run": "lot",
}

export const autoPictureFor = (route: Route): string => AUTO[route] ?? "neon"

export const USER_PREFIX = "user:"

/** Your own pictures live in a folder on this computer. They are fetched with the token, like any other call. */
export async function loadUserPicture(name: string): Promise<string | undefined> {
  const token = sessionStorage.getItem("gatehouse.token") ?? ""
  try {
    const res = await fetch(`/api/scenes/pictures/${encodeURIComponent(name)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) return undefined
    return URL.createObjectURL(await res.blob())
  } catch {
    return undefined
  }
}

/** The address to paint for a choice, or undefined while a user picture loads or if it is gone. */
export async function pictureUrl(choice: PictureChoice, route: Route): Promise<string | undefined> {
  if (choice.startsWith(USER_PREFIX)) return loadUserPicture(choice.slice(USER_PREFIX.length))
  const id = choice === "auto" ? autoPictureFor(route) : choice
  const hit = BUILTIN_PICTURES.find((p) => p.id === id) ?? BUILTIN_PICTURES[0]
  return `./${hit.file}`
}
