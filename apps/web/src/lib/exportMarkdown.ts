import { summarise } from "./groups"
import { stamp } from "./format"
import type { Item } from "./transcript"

type Tool = Extract<Item, { kind: "tool" }>

/**
 * A session as a Markdown file you can keep or share: what you asked, what Claude said, and a line for each run of
 * tool calls with the commands it ran. Tool output and file contents are left out, so an export carries no more
 * of your files than the conversation itself did.
 */
export function toMarkdown(
  items: Item[],
  about: { title: string; cwd?: string; at?: number },
): string {
  const out: string[] = [`# ${about.title}`, ""]
  const facts = [
    about.cwd ? `Folder: \`${about.cwd}\`` : undefined,
    `Exported from Jean-Claude Van Code ${about.at ? `on ${stamp(about.at, about.at)}` : ""}`.trim(),
  ].filter(Boolean)
  out.push(...facts.map((f) => `${f}  `), "")
  let run: Tool[] = []
  const flush = () => {
    if (!run.length) return
    out.push(`> ${summarise(run)}`)
    for (const t of run) {
      const cmd = typeof t.input.command === "string" ? t.input.command : undefined
      if (cmd) out.push(">", "> ```", ...cmd.split("\n").map((l) => `> ${l}`), "> ```")
    }
    out.push("")
    run = []
  }
  for (const it of items) {
    if (it.kind === "tool") {
      if (!it.subagent) run.push(it)
      continue
    }
    flush()
    const when = it.at ? ` (${stamp(it.at)})` : ""
    if (it.kind === "user") {
      out.push(`## You${when}`, "", it.text || "_(a picture)_", "")
      for (const im of it.images ?? []) out.push(`_Picture: ${im.name}_`, "")
    } else if (it.kind === "text" && !it.subagent) out.push(`## Claude${when}`, "", it.text, "")
    else if (it.kind === "result" && it.isError)
      out.push(`_The turn ended with an error: ${it.text}_`, "")
  }
  flush()
  return (
    out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  )
}

/** "login-fix-2026-10-30.md" */
export function exportName(title: string, at: number = Date.now()): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "session"
  return `${slug}-${new Date(at).toISOString().slice(0, 10)}.md`
}

/** Saves text as a file through the browser's own download, which the window puts in your Downloads folder. */
export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
