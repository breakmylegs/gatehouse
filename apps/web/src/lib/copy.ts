/**
 * Copying to the clipboard (owner, 1 Nov: "I cant easily copy messages, or bits of separate text"). With html as well,
 * a paste into Word or Outlook keeps the formatting and a paste into a plain editor gets the text (markdown for a
 * message), as the ChatGPT and Claude desktop apps do. The window's own clipboard can refuse (no focus, an older
 * engine), so a hidden text box copies instead.
 */
export async function copyText(text: string, html?: string): Promise<boolean> {
  try {
    if (html !== undefined && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ])
      return true
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused: the text box below may still work.
  }
  return copyThroughTextBox(text)
}

function copyThroughTextBox(text: string): boolean {
  const box = document.createElement("textarea")
  box.value = text
  box.setAttribute("readonly", "")
  box.style.position = "fixed"
  box.style.opacity = "0"
  const was = document.activeElement as HTMLElement | null
  document.body.appendChild(box)
  box.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  box.remove()
  was?.focus?.()
  return ok
}
