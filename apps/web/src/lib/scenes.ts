import type { Route } from "../store"

/**
 * The pictures that come with the app, for the Codehouse look: the background scenes from the Codehouse visual
 * identity pack (owner, 2 Nov: original artwork, royalty-free, nothing taken from any film). Each has a dark version
 * and, where the pack has one, a light version for the light theme. The first four ids are the ones earlier versions
 * saved, so a saved choice still finds its picture; a choice for a picture that has gone falls back to the first.
 */
export const BUILTIN_PICTURES = [
  {
    id: "neon",
    label: "The sign at night",
    file: "codehouse/scenes/scene-neon-sign.png",
    light: "codehouse/scenes/scene-neon-sign-light.png",
  },
  {
    id: "highway",
    label: "The highway",
    file: "codehouse/scenes/scene-highway.png",
    light: "codehouse/scenes/scene-highway-light.png",
  },
  {
    id: "bar",
    label: "Inside the bar",
    file: "codehouse/scenes/scene-bar.png",
    light: "codehouse/scenes/scene-bar-light.png",
  },
  {
    id: "lot",
    label: "The parking lot",
    file: "codehouse/scenes/scene-lot.png",
    light: "codehouse/scenes/scene-lot-light.png",
  },
  {
    id: "front",
    label: "The front door",
    file: "codehouse/scenes/scene-front.png",
    light: "codehouse/scenes/scene-front-light.png",
  },
  {
    id: "porch",
    label: "The porch",
    file: "codehouse/scenes/scene-porch.png",
    light: "codehouse/scenes/scene-porch-light.png",
  },
  {
    id: "car-park",
    label: "The car park",
    file: "codehouse/scenes/scene-car-park.png",
    light: "codehouse/scenes/scene-car-park-light.png",
  },
  { id: "jukebox", label: "The jukebox", file: "codehouse/scenes/scene-jukebox.png" },
  { id: "dawn", label: "Dawn", file: "codehouse/scenes/scene-dawn.png" },
] as const satisfies ReadonlyArray<{ id: string; label: string; file: string; light?: string }>

export type Theme = "light" | "dark"

/** The file to show for a picture in a theme: its light version in the light theme, if it has one. */
export const sceneFile = (p: (typeof BUILTIN_PICTURES)[number], theme: Theme): string =>
  theme === "light" && "light" in p ? p.light : p.file

export type PictureChoice = "auto" | string

/** In "auto", each screen gets its own picture, so the background changes as you move around. */
const AUTO: Partial<Record<Route, string>> = {
  approvals: "neon",
  sessions: "highway",
  dashboard: "car-park",
  workspace: "bar",
  chat: "porch",
  projects: "front",
  memory: "jukebox",
  prompts: "jukebox",
  marketplace: "front",
  doctor: "dawn",
  home: "neon",
  usage: "car-park",
  policy: "lot",
  audit: "highway",
  approver: "lot",
  devices: "bar",
  settings: "neon",
  guide: "dawn",
  setup: "dawn",
  "first-run": "dawn",
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
export async function pictureUrl(
  choice: PictureChoice,
  route: Route,
  theme: Theme = "dark",
): Promise<string | undefined> {
  if (choice.startsWith(USER_PREFIX)) return loadUserPicture(choice.slice(USER_PREFIX.length))
  const id = choice === "auto" ? autoPictureFor(route) : choice
  const hit = BUILTIN_PICTURES.find((p) => p.id === id) ?? BUILTIN_PICTURES[0]
  return `./${sceneFile(hit, theme)}`
}
