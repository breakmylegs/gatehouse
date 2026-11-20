/**
 * T-137: what the window in a picture was, as the window app says before the picture: its program and title. Both are
 * cut short and made one line; a message that is not one of these is ignored.
 */
export interface WindowFrom {
  app: string
  title: string
}

const line = (v: unknown, max: number) =>
  typeof v === "string" ? [...v].map((c) => (c < " " ? " " : c)).join("").replace(/\s+/g, " ").trim().slice(0, max) : ""

export function readWindowFrom(m: string): WindowFrom | undefined {
  if (!m.startsWith("captured-from:")) return undefined
  try {
    const v = JSON.parse(m.slice("captured-from:".length)) as { app?: unknown; title?: unknown }
    const from = { app: line(v.app, 100), title: line(v.title, 200) }
    return from.app || from.title ? from : undefined
  } catch {
    return undefined
  }
}

/** The attachment's file name: the program's, made safe for a file. */
export const pictureName = (from: WindowFrom | undefined): string =>
  from?.app ? `${from.app.replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "window"}.png` : "screen.png"

/** The line the message carries about the picture, so Claude knows what window it shows. */
export const pictureLine = (from: WindowFrom | undefined): string =>
  from ? `(A picture of ${from.app || "a window"}${from.title ? `: ${from.title}` : ""})` : ""
