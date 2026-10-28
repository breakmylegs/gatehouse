import { useStore } from "../store"

const FILES = {
  soldier: "jcvc/soldier.webp",
  stance: "jcvc/stance.png",
  beret: "jcvc/beret.webp",
} as const

/** A picture for Jean-Claude mode. It renders nothing when the mode is off or the file is missing. */
export function JcvcArt({ which }: { which: keyof typeof FILES }) {
  const on = useStore((s) => s.jcMode)
  if (!on) return null
  return (
    <img
      src={`./${FILES[which]}`}
      alt=""
      data-jcvc={which}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.hidden = true
      }}
      className="mt-3 block max-h-64 max-w-full rounded object-cover"
    />
  )
}
