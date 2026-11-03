/**
 * B45: an artifact saved as a file that works offline and behaves as it did in Codehouse. In the app a page runs in a
 * sandbox with no network; opened from a file in a browser it would not be, so the export carries the same rules in
 * the page itself: its own inline script and style, pictures from inside it, and nothing fetched from anywhere.
 */
export const OFFLINE_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ")

const META = `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_POLICY}">`

/** The page with the offline rules first in its head, so nothing in it runs before them. Pictures are left as they are. */
export function offlineExport(kind: "html" | "svg", content: string): string {
  if (kind !== "html") return content
  const head = /<head[^>]*>/i.exec(content)
  if (head) return content.replace(head[0], `${head[0]}${META}`)
  const html = /<html[^>]*>/i.exec(content)
  if (html) return content.replace(html[0], `${html[0]}<head>${META}</head>`)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(content)
  if (doctype) return content.replace(doctype[0], `${doctype[0]}\n<head>${META}</head>`)
  return `<!doctype html>\n<head>${META}</head>\n${content}`
}
