import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

/** A picture shown large over the page. Esc, the Close button or a click anywhere closes it. */
export function PictureViewer({
  url,
  name,
  onClose,
}: {
  url: string
  name: string
  onClose: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  const back = useRef<HTMLElement | null>(null)
  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      back.current?.focus?.()
    }
  }, [onClose])
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="picture-viewer"
      onClick={onClose}
    >
      <img src={url} alt={name} onClick={(e) => e.stopPropagation()} />
      <button ref={close} type="button" className="btn" onClick={onClose}>
        Close
      </button>
    </div>,
    document.body,
  )
}
