// The little fighter (owner, 16 Nov): a whimsy in two places. He waits in his stance beside each request in the notch's
// list, and he spars where a session shows it is working, in place of the turning ring. Drawn at his own 48 pixels, so
// the pixel art stays sharp; turned to face what he stands beside. With Reduce motion, on the Mac or in Settings,
// Appearance, he stands still. The sheet and its frames: public/codehouse/fighter.png (docs/brand).
import clsx from "clsx"
import { useEffect, useState } from "react"

type Frame = readonly [x: number, y: number, ms: number]
const row = (y: number, ms: number[]): Frame[] => ms.map((d, i) => [i * 48, y, d] as const)
const IDLE = row(0, [180, 180, 180, 180])
const WALK = row(48, [120, 120, 120, 120])
const PUNCH = row(96, [80, 120, 100])
const KICK = row(144, [90, 160, 110])

/** Waiting: his stance, over and over. Working: a bout, stance, punch, step, kick. */
const MOVES: Record<"waiting" | "working", Frame[]> = {
  waiting: IDLE,
  working: [...IDLE, ...PUNCH, ...IDLE, ...WALK, ...KICK],
}

/** From the page's own address, as the icon sprite is (Icon.tsx), wherever the Host serves it. */
const SHEET = "url(./codehouse/fighter.png)"

/** His face, from his stance: the 16 pixels square of his head (owner, 19 Nov: in the notch's wing, for its dot). */
export function FighterFace({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx("fighter-face", className)}
      style={{ backgroundImage: SHEET, backgroundPosition: "-28px -1px" }}
    />
  )
}

const still = () =>
  document.documentElement.dataset.motion === "reduced" ||
  (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)

export function Fighter({ mode, className }: { mode: "waiting" | "working"; className?: string }) {
  const moves = MOVES[mode]
  const [at, setAt] = useState(0)
  useEffect(() => {
    if (still()) return setAt(0)
    let i = 0
    let t: ReturnType<typeof setTimeout>
    const next = () => {
      t = setTimeout(() => {
        i = (i + 1) % moves.length
        setAt(i)
        next()
      }, moves[i]![2])
    }
    next()
    return () => clearTimeout(t)
  }, [moves])
  const [x, y] = moves[at % moves.length]!
  return (
    <span
      aria-hidden="true"
      className={clsx("fighter", className)}
      data-mode={mode}
      style={{ backgroundImage: SHEET, backgroundPosition: `-${x}px -${y}px` }}
    />
  )
}
