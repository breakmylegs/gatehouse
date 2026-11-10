import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Browser tools (owner's Settings overhaul, 6 Nov): a coding session looks at a page this computer serves, as a picture
 * and its text, to check its work. Only http or https on localhost or 127.0.0.1. Edge takes the picture in headless
 * mode with its own documented switches (--screenshot, --dump-dom), in a profile made for the one look and removed
 * straight after; never a debugging, automation or extension switch, and never your own profile. The text is redacted
 * before Claude sees it. Pictures cannot be redacted, which Settings says.
 */
export class PageLookError extends Error {}

/** The address, checked: a page on this computer, with no name or password in it. */
export function checkPageUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new PageLookError("That is not a web address.")
  }
  if (
    (u.protocol !== "http:" && u.protocol !== "https:") ||
    (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") ||
    u.username ||
    u.password
  )
    throw new PageLookError(
      "Only pages on this computer can be looked at: http://localhost or http://127.0.0.1.",
    )
  return u.toString()
}

/** The switches Edge is given for one look, and nothing else. */
export function edgeLookArgs(profile: string, what: { shot: string } | "dom", url: string): string[] {
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    `--user-data-dir=${profile}`,
    "--window-size=1280,800",
    "--hide-scrollbars",
    what === "dom" ? "--dump-dom" : `--screenshot=${what.shot}`,
    url,
  ]
}

/** A page's words from its HTML: no scripts, styles or tags, entities made plain, at most `max` characters. */
export function pageText(html: string, max = 20_000): string {
  const text = html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
  return text.length > max ? `${text.slice(0, max)}\n[the rest was left out]` : text
}

type Run = (exe: string, args: string[], timeoutMs: number) => Promise<string>

const run: Run = (exe, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (e, stdout) => (e ? reject(e) : resolve(String(stdout))),
    )
  })

export interface PageLookDeps {
  edge: () => Promise<string | undefined>
  redact: (text: string) => string
  run?: Run
  tmpDir?: string
}

/** One look: a picture (PNG, base64) and the page's text, or a reason it could not be had. */
export async function lookAtPage(
  raw: string,
  d: PageLookDeps,
): Promise<{ text: string; image?: string; isError?: boolean }> {
  let url: string
  try {
    url = checkPageUrl(raw)
  } catch (e) {
    return { text: (e as Error).message, isError: true }
  }
  const edge = await d.edge()
  if (!edge)
    return { text: "Microsoft Edge was not found, so the page cannot be looked at.", isError: true }
  const exec = d.run ?? run
  const dir = fs.mkdtempSync(path.join(d.tmpDir ?? os.tmpdir(), "codeh-look-"))
  try {
    const shot = path.join(dir, "page.png")
    // The picture and the text side by side, each in a profile of its own (one profile cannot be open twice).
    const [, dom] = await Promise.all([
      exec(edge, edgeLookArgs(path.join(dir, "a"), { shot }, url), 30_000),
      exec(edge, edgeLookArgs(path.join(dir, "b"), "dom", url), 30_000).catch(() => ""),
    ])
    if (!fs.existsSync(shot))
      return { text: `Edge took no picture of ${url}. Is the server running?`, isError: true }
    const image = fs.readFileSync(shot).toString("base64")
    const words = d.redact(pageText(dom))
    return {
      image,
      text: `A picture of ${url} at 1280 by 800, and its text:\n${words || "(no text)"}`,
    }
  } catch (e) {
    return {
      text: `The page could not be looked at: ${(e as Error).message.slice(0, 300)}`,
      isError: true,
    }
  } finally {
    // Owner, 1 Nov: leaked Edge profiles filled the disk. The one made for this look goes now, tried a few times while
    // Edge lets go of it.
    for (let i = 0; i < 10 && fs.existsSync(dir); i++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        await new Promise((r) => setTimeout(r, 300))
      }
    }
  }
}
