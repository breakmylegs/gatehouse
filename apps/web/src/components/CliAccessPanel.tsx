import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

/**
 * T-124: the command line for scripts on this computer, off until you switch it on. On, the `codehouse` command can
 * list sessions, start one in Manual mode, send it a prompt and read its last answer; never a decision, the policy, a
 * mode or the kill switch.
 */
export function CliAccessPanel() {
  const [on, setOn] = useState<boolean>()
  useEffect(() => {
    void api<{ on: boolean }>("GET", "/api/cli-access").then((r) => setOn(r.ok && r.data ? r.data.on : false))
  }, [])
  async function flip(next: boolean) {
    const r = await api<{ on: boolean }>("PUT", "/api/cli-access", { on: next })
    if (!r.ok || !r.data) return toast.error(r.error ?? "Not changed", { id: "cli-access" })
    setOn(r.data.on)
    toast(r.data.on ? "The command line is on" : "The command line is off", { id: "cli-access" })
  }
  return (
    <div className="grid gap-2 text-[13px]">
      <p className="m-0 text-xs text-mut">
        Scripts on this computer can use the codehouse command to list sessions, start one in a project folder in Manual
        mode, send it a prompt (and wait for the answer), and read what it last said. It can never answer an approval,
        change your rules or a mode, or use the kill switch. Its token is sealed for you on this computer, and every call
        is recorded. Switching it off, or on again, stops the old token.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={on === undefined} checked={on === true} onChange={(e) => void flip(e.target.checked)} />
        Command line on
      </label>
      {on ? (
        <code className="mono whitespace-pre-wrap text-xs">
          {"npm run codehouse -- list\nnpm run codehouse -- start C:\\dev\\shop \"Fix the failing test\"\nnpm run codehouse -- send <session id> \"And the docs\" --wait\nnpm run codehouse -- show <session id>"}
        </code>
      ) : null}
    </div>
  )
}
