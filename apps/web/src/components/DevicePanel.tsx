import { useEffect, useRef, useState } from "react"
import { api, fetchImage } from "../lib/api"

/**
 * T-118 (in part): an Android emulator or iOS simulator running on this computer, beside the session: choose one and
 * see its screen, taken again when you ask. Only shown when the device tools are there and one is running.
 */
interface Device {
  kind: "android" | "ios"
  id: string
  name: string
}

export function DevicePanel() {
  const [devices, setDevices] = useState<Device[]>()
  const [chosen, setChosen] = useState<string>()
  const [shot, setShot] = useState<string>()
  const [error, setError] = useState<string>()
  const last = useRef<string | undefined>(undefined)
  useEffect(() => {
    void api<{ devices: Device[] }>("GET", "/api/device-panel/list").then((r) => setDevices(r.ok && r.data ? r.data.devices : []))
    return () => {
      if (last.current) URL.revokeObjectURL(last.current)
    }
  }, [])
  const device = devices?.find((d) => `${d.kind}:${d.id}` === chosen) ?? devices?.[0]
  const take = async () => {
    if (!device) return
    const r = await fetchImage(`/api/device-panel/shot?kind=${device.kind}&id=${encodeURIComponent(device.id)}`)
    if ("error" in r) return setError(r.error)
    if (last.current) URL.revokeObjectURL(last.current)
    last.current = r.src
    setShot(r.src)
    setError(undefined)
  }
  if (!devices) return <p className="m-0 text-[13px] text-mut">Looking for emulators and simulators...</p>
  if (!devices.length) return <p className="m-0 text-[13px] text-mut">No Android emulator or iOS simulator is running here.</p>
  return (
    <div className="grid gap-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-1">
        <select aria-label="Device" className="field !min-h-7" value={device ? `${device.kind}:${device.id}` : ""} onChange={(e) => setChosen(e.target.value)}>
          {devices.map((d) => (
            <option key={`${d.kind}:${d.id}`} value={`${d.kind}:${d.id}`}>
              {d.name} ({d.kind === "android" ? "Android" : "iOS"})
            </option>
          ))}
        </select>
        <button type="button" className="btn !min-h-7" onClick={() => void take()}>
          {shot ? "Take again" : "Show its screen"}
        </button>
      </div>
      {error ? <p role="alert" className="m-0">{error}</p> : null}
      {shot ? <img src={shot} alt={`The screen of ${device?.name ?? "the device"}`} className="max-h-[60vh] w-auto rounded-md border border-line" /> : null}
    </div>
  )
}
