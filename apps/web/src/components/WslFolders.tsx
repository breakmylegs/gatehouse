import { useEffect, useState } from "react"
import { api } from "../lib/api"

/**
 * T-008: the WSL distros on this computer, each a button that puts its home folder in the start form, so a project
 * inside the distro can be opened (by its \\wsl.localhost path) and its commands run there. Hidden when there are none.
 */
export function WslFolders({ onPick }: { onPick: (folder: string) => void }) {
  const [distros, setDistros] = useState<Array<{ name: string; home?: string }>>([])
  useEffect(() => {
    void api<{ distros: Array<{ name: string; home?: string }> }>("GET", "/api/wsl/distros").then((r) => r.ok && r.data && setDistros(r.data.distros))
  }, [])
  const homes = distros.filter((d): d is { name: string; home: string } => Boolean(d.home))
  if (!homes.length) return null
  return (
    <span className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-mut">In WSL:</span>
      {homes.map((d) => (
        <button key={d.name} type="button" className="cursor-pointer border-0 bg-transparent p-0 text-acc underline" onClick={() => onPick(d.home)}>
          {d.name}
        </button>
      ))}
    </span>
  )
}
