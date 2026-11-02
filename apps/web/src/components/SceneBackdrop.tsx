import { useEffect } from "react"
import { pictureUrl } from "../lib/scenes"
import { useStore } from "../store"

/**
 * The Codehouse look, always on: a very faint scene from the pack behind the page, its light version in the light theme. It paints through a CSS variable that the page
 * background reads (see styles.css), so it sits behind every panel and never over any text.
 */
export function SceneBackdrop() {
  const choice = useStore((s) => s.jcPic)
  const route = useStore((s) => s.route)
  const theme = useStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    let cancelled = false
    let made: string | undefined
    void pictureUrl(choice, route, theme).then((url) => {
      if (cancelled) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url)
        return
      }
      made = url
      // Absolute, because a relative address inside a custom property is read against the stylesheet, not the page.
      if (url)
        root.style.setProperty("--scene-img", `url("${new URL(url, document.baseURI).href}")`)
      else root.style.removeProperty("--scene-img")
    })
    return () => {
      cancelled = true
      if (made?.startsWith("blob:")) URL.revokeObjectURL(made)
    }
  }, [choice, route, theme])

  return null
}
