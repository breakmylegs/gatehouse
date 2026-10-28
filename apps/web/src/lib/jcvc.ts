import type { Route } from "../store"

/** The pictures that come with the app, for Jean-Claude mode. */
export const BUILTIN_PICTURES = [
  { id: "soldier", label: "Night patrol", file: "jcvc/soldier.webp" },
  { id: "stance", label: "Fighting stance", file: "jcvc/stance.png" },
  { id: "beret", label: "Blue beret", file: "jcvc/beret.webp" },
  { id: "trucks", label: "The split", file: "jcvc/loading-trucks.png" },
] as const

export type PictureChoice = "auto" | string

/** In "auto", each screen gets its own picture, so the background changes as you move around. */
const AUTO: Partial<Record<Route, string>> = {
  approvals: "soldier",
  sessions: "stance",
  workspace: "beret",
  policy: "trucks",
  audit: "stance",
  devices: "beret",
  settings: "soldier",
  setup: "trucks",
  "first-run": "trucks",
}

export const autoPictureFor = (route: Route): string => AUTO[route] ?? "soldier"

export const USER_PREFIX = "user:"

/** Your own pictures live in a folder on this computer. They are fetched with the token, like any other call. */
export async function loadUserPicture(name: string): Promise<string | undefined> {
  const token = sessionStorage.getItem("gatehouse.token") ?? ""
  try {
    const res = await fetch(`/api/jcvc/pictures/${encodeURIComponent(name)}`, {
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
