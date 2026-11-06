import { useState } from "react"
import { readViewerPrefs, saveViewerPrefs, type ViewerPrefs } from "../lib/viewerPrefs"

/** Settings, Sessions, Viewer: two choices kept in this window. */
export function ViewerSetting() {
  const [p, setP] = useState<ViewerPrefs>(readViewerPrefs)
  const set = (next: Partial<ViewerPrefs>) => {
    const all = { ...p, ...next }
    setP(all)
    saveViewerPrefs(all)
  }
  return (
    <>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={p.autoOpen}
          onChange={(e) => set({ autoOpen: e.target.checked })}
        />
        Open a web page or picture Claude writes in the viewer beside the session
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={p.localLinks}
          onChange={(e) => set({ localLinks: e.target.checked })}
        />
        Open links to pages on this computer (localhost) in the viewer, not your browser
      </label>
      <p className="m-0 text-[13px] text-mut">
        Pages from the internet never open inside Codehouse: their links go to your browser.
      </p>
    </>
  )
}
