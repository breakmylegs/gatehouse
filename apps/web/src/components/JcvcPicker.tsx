import { useCallback, useEffect, useState } from "react"
import { api } from "../lib/api"
import { BUILTIN_PICTURES, loadUserPicture, USER_PREFIX } from "../lib/jcvc"
import { useStore } from "../store"

function Thumb({ choice, label }: { choice: string; label: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    if (!choice.startsWith(USER_PREFIX)) {
      const hit = BUILTIN_PICTURES.find((p) => p.id === choice)
      setSrc(hit ? `./${hit.file}` : undefined)
      return
    }
    let url: string | undefined
    let gone = false
    void loadUserPicture(choice.slice(USER_PREFIX.length)).then((u) => {
      url = u
      if (!gone) setSrc(u)
    })
    return () => {
      gone = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [choice])
  return src ? (
    <img src={src} alt="" className="h-14 w-20 rounded object-cover" />
  ) : (
    <span className="grid h-14 w-20 place-items-center rounded bg-s2 text-xs text-mut">
      {label.slice(0, 2)}
    </span>
  )
}

/** Choose which picture sits behind the screens: automatic (it changes by screen), one of ours, or one of yours. */
export function JcvcPicker() {
  const choice = useStore((s) => s.jcPic)
  const setChoice = useStore((s) => s.setJcPic)
  const [mine, setMine] = useState<string[]>([])
  const [folder, setFolder] = useState<string>()

  const load = useCallback(async () => {
    const r = await api<{ names: string[]; folder: string }>("GET", "/api/jcvc/pictures")
    if (r.ok && r.data) {
      setMine(r.data.names)
      setFolder(r.data.folder)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const options: Array<{ id: string; label: string }> = [
    ...BUILTIN_PICTURES.map((p) => ({ id: p.id, label: p.label })),
    ...mine.map((n) => ({ id: USER_PREFIX + n, label: n })),
  ]

  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-1 text-[13px] font-semibold">Picture</legend>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="jcpic"
          checked={choice === "auto"}
          onChange={() => setChoice("auto")}
        />
        Automatic: a different picture on each screen
      </label>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <label key={o.id} className="grid cursor-pointer justify-items-center gap-1 text-xs">
            <Thumb choice={o.id} label={o.label} />
            <span className="flex items-center gap-1">
              <input
                type="radio"
                name="jcpic"
                checked={choice === o.id}
                onChange={() => setChoice(o.id)}
                aria-label={o.label}
              />
              <span className="max-w-20 truncate">{o.label}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="m-0 text-xs text-mut">
        Add your own: copy picture files (png, jpg, webp or gif) into{" "}
        <span className="mono">{folder ?? "the jcvc folder in your JCVC data folder"}</span>, then{" "}
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-acc underline"
          onClick={() => void load()}
        >
          look again
        </button>
        . Use pictures you have the right to use.
      </p>
    </fieldset>
  )
}
