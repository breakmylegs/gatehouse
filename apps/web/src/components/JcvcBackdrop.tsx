import { useEffect } from "react"
import { pictureUrl } from "../lib/jcvc"
import { useStore } from "../store"

/**
 * Jean-Claude mode, always on: a very faint picture behind the page, in the light and the dark theme. It paints through a CSS variable that the page
 * background reads (see styles.css), so it sits behind every panel and never over any text.
 */
export function JcvcBackdrop() {
  const choice = useStore((s) => s.jcPic)
  const route = useStore((s) => s.route)

  useEffect(() => {
    const root = document.documentElement
    let cancelled = false
    let made: string | undefined
    void pictureUrl(choice, route).then((url) => {
      if (cancelled) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url)
        return
      }
      made = url
      // Absolute, because a relative address inside a custom property is read against the stylesheet, not the page.
      if (url) root.style.setProperty("--jcvc-img", `url("${new URL(url, document.baseURI).href}")`)
      else root.style.removeProperty("--jcvc-img")
    })
    return () => {
      cancelled = true
      if (made?.startsWith("blob:")) URL.revokeObjectURL(made)
    }
  }, [choice, route])

  return null
}
