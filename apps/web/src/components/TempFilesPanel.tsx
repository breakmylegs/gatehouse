import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { onMac } from "../lib/platform-mac" // Mac fork

const mb = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(bytes ? 0.1 : 0, bytes / 1024 ** 2).toFixed(1)} MB`

/**
 * Codehouse's temporary leftovers in the Windows temp folder, and Clear (owner, 1 Nov: the disk filled). Codehouse also clears
 * those an hour old or more when it starts and once a day; this is for now.
 */
export function TempFilesPanel() {
  const [use, setUse] = useState<{ items: number; bytes: number }>()
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const r = await api<{ items: number; bytes: number }>("GET", "/api/housekeeping/temp")
    if (r.ok && r.data) setUse(r.data)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  async function clear() {
    setBusy(true)
    const r = await api<{ removed: number; bytes: number; left: number }>(
      "POST",
      "/api/housekeeping/temp/clear",
      {},
    )
    setBusy(false)
    if (!r.ok || !r.data) {
      toast.error(r.error ?? "The temporary files were not cleared", { id: "temp" })
      return
    }
    toast(
      `Cleared ${r.data.removed} temporary ${r.data.removed === 1 ? "item" : "items"}, ${mb(r.data.bytes)}.${r.data.left ? ` ${r.data.left} still in use stayed.` : ""}`,
      { id: "temp" },
    )
    await load()
  }
  return (
    <div className="grid gap-2">
      <p className="m-0 text-xs text-mut">
        Temporary files Codehouse and its checks leave in {onMac("the Windows temp folder", "the Mac's temporary folder")} when a run is cut
        off. Codehouse clears those an hour old or more when it starts and once a day, and asks
        every coding session to delete the temporary files it makes. Nothing else in the temp folder
        is touched.
      </p>
      <p role="status" className="m-0 text-[13.5px]">
        {use === undefined
          ? "Measuring…"
          : use.items === 0
            ? "None left now."
            : `${use.items} ${use.items === 1 ? "item" : "items"}, ${mb(use.bytes)}.`}
      </p>
      <div>
        <button
          type="button"
          className="btn"
          disabled={busy || !use?.items}
          onClick={() => void clear()}
        >
          {busy ? "Clearing" : "Clear temporary files"}
        </button>
      </div>
    </div>
  )
}
