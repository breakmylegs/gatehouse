import { useEffect, useState } from "react"
import { api } from "../lib/api"

/**
 * T-067: what your organisation's managed policy sets, at the top of Settings: Managed by ..., and each limit in
 * words, including the settings you cannot change here. Nothing shows without a managed policy.
 */
interface Managed {
  managed: boolean
  label?: string
  lines?: string[]
  locked?: string[]
}

export function ManagedNote() {
  const [m, setM] = useState<Managed>()
  useEffect(() => {
    void api<Managed>("GET", "/api/managed").then((r) => r.ok && r.data && setM(r.data))
  }, [])
  if (!m?.managed) return null
  return (
    <section role="note" aria-label={m.label} className="my-3 grid gap-1 rounded-md border border-line bg-s1 p-3 text-[13px]">
      <strong className="text-[14px]">{m.label}</strong>
      <ul className="m-0 grid gap-0.5 pl-5">
        {(m.lines ?? []).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  )
}
