import { toast } from "sonner"
import { api } from "../lib/api"

const WHY: Record<string, string> = {
  doctor: "you chose it in Doctor",
  "start-flag": "Codehouse was started in safe mode",
  "crash-restarts": "Codehouse stopped unexpectedly three times in ten minutes",
  canary: "a safety check failed (see Doctor)",
}

/**
 * E-096: safe mode, said across the top: why, what it leaves out, and how to leave it. Leaving is a desktop action,
 * so Neighbourhood Watch shows the banner without the button.
 */
export function SafeModeBanner({ reason }: { reason?: string | undefined }) {
  const remote = import.meta.env.VITE_CODEHOUSE_REMOTE === "cnw"
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-sev bg-s1 px-4 py-2 font-semibold text-sev">
      <span>
        Safe mode, because {WHY[reason ?? ""] ?? "it was turned on"}. No session was brought back, and no plugins, routines,
        warm chat or push channels are running.
      </span>
      {remote ? null : (
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const r = await api("POST", "/api/safe-mode", { on: false })
            if (r.ok) toast("Safe mode is off. Restart Codehouse to start everything again.", { id: "safe-mode" })
            else toast.error(r.error ?? "Safe mode could not be left.", { id: "safe-mode" })
          }}
        >
          Leave safe mode
        </button>
      )}
    </div>
  )
}
