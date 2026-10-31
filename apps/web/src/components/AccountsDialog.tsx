import { useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { MAIN_ACCOUNT, send, useStore } from "../store"

interface SignInStatus {
  state: "idle" | "waiting" | "finished" | "failed"
  message: string
  url?: string
}

/**
 * Your Claude accounts (owner, 30 Oct): add one, sign it in through Anthropic's own page (in a private window if
 * your browser is signed in to another), confirm the organisation it belongs to, and remove it. Sessions on one
 * account keep running while you look at another.
 */
export function AccountsDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const accounts = useStore((s) => s.health?.accounts) ?? []
  const active = useStore((s) => s.activeAccount)
  const setActive = useStore((s) => s.setActiveAccount)
  const [label, setLabel] = useState("")
  const [signingIn, setSigningIn] = useState<string>()
  const [status, setStatus] = useState<SignInStatus>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // While a sign-in is under way, ask how it is going, for the page address and the end.
  useEffect(() => {
    if (!signingIn) return
    const t = setInterval(() => {
      void send({ type: "signin_status", account: signingIn }).then((r) => {
        if (r.ok && r.data) setStatus(r.data as SignInStatus)
      })
    }, 1500)
    return () => clearInterval(t)
  }, [signingIn])

  async function add() {
    setBusy(true)
    const r = await send({ type: "account_add", label: label.trim() || "Another account" })
    setBusy(false)
    if (!r.ok) return void toast.error(r.error?.message ?? "The account was not added")
    setLabel("")
    void signIn((r.data as { id: string }).id, "claudeai")
  }
  async function signIn(account: string, method: "claudeai" | "sso") {
    setSigningIn(account)
    const r = await send({ type: "signin_start", account, method })
    if (r.ok && r.data) setStatus(r.data as SignInStatus)
    else toast.error(r.error?.message ?? "The sign-in did not start")
  }
  async function act(command: Parameters<typeof send>[0], done: string) {
    const r = await send(command)
    if (r.ok) toast(done, { id: "accounts" })
    else toast.error(r.error?.message ?? "That did not work", { id: "accounts" })
  }

  return createPortal(
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="panel grid max-h-[90vh] w-[600px] max-w-[94vw] gap-4 overflow-auto p-5"
      >
        <h2 id={titleId} className="m-0 text-lg font-semibold">
          Your Claude accounts
        </h2>
        <p className="m-0 text-[13.5px] text-mut">
          Each account signs in through Anthropic's own page and keeps its own sessions. The one you
          show is the one new sessions start on; sessions on the others keep running. JCVC never
          reads a sign-in itself.
        </p>
        <ul className="m-0 grid list-none gap-2 p-0">
          {accounts.map((a) => (
            <li key={a.id} className="grid gap-2 rounded border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {a.label}
                  {a.id === active ? (
                    <span className="font-normal text-mut"> (showing)</span>
                  ) : null}
                </span>
                <span className="text-[13px] text-mut">
                  {a.signedIn ? (a.email ?? "Signed in") : "Not signed in"}
                </span>
              </div>
              {a.signedIn ? (
                <p className="m-0 text-[13px]">
                  {a.expectedOrg
                    ? a.orgOk
                      ? `Belongs to ${a.expectedOrg}.`
                      : `Must belong to ${a.expectedOrg}, but says ${a.organization ?? "no organisation"}. Its sessions will not start.`
                    : `Says it belongs to ${a.organization ?? "no organisation"}. Confirm it, and its sessions can start.`}
                </p>
              ) : null}
              <span className="flex flex-wrap gap-2">
                {a.id !== active ? (
                  <button type="button" className="btn !min-h-7" onClick={() => setActive(a.id)}>
                    Show this account
                  </button>
                ) : null}
                {!a.signedIn || signingIn === a.id ? (
                  <>
                    <button
                      type="button"
                      className="btn !min-h-7"
                      onClick={() => void signIn(a.id, "claudeai")}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      className="btn !min-h-7"
                      onClick={() => void signIn(a.id, "sso")}
                    >
                      Sign in with single sign-on
                    </button>
                  </>
                ) : null}
                {a.id !== MAIN_ACCOUNT && a.signedIn && !a.expectedOrg && a.organization ? (
                  <button
                    type="button"
                    className="btn btn-primary !min-h-7"
                    onClick={() =>
                      void act(
                        { type: "account_confirm_org", account: a.id },
                        `${a.label} must belong to ${a.organization}.`,
                      )
                    }
                  >
                    Confirm {a.organization}
                  </button>
                ) : null}
                {a.id !== MAIN_ACCOUNT ? (
                  <button
                    type="button"
                    className="btn btn-deny !min-h-7"
                    onClick={() =>
                      void act({ type: "account_remove", account: a.id }, `${a.label} was removed.`)
                    }
                  >
                    Remove
                  </button>
                ) : null}
              </span>
              {signingIn === a.id && status ? (
                <div className="grid gap-1.5 text-[13px]" aria-live="polite">
                  <span>{status.message}</span>
                  {status.state === "waiting" && status.url ? (
                    <span className="grid gap-1.5">
                      <span className="text-mut">
                        If your browser is signed in to another Claude account, it may sign this one
                        in as that one. Open the page in a private window instead.
                      </span>
                      <button
                        type="button"
                        className="btn w-fit !min-h-7"
                        onClick={() =>
                          void act(
                            { type: "account_private_window", account: a.id },
                            "Opened in a private Edge window.",
                          )
                        }
                      >
                        Open in a private window
                      </button>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="grid gap-2 border-t border-line pt-3">
          <label className="grid gap-1">
            <span className="font-semibold">Add an account</span>
            <span className="text-[13px] text-mut">
              A name for it, such as Personal. Then sign it in.
            </span>
            <input
              className="field"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
          </label>
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void add()}
            >
              Add and sign in
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </span>
          <p className="m-0 text-[12.5px] text-mut">
            This laptop's managed policy applies to every account, and may refuse an account outside
            your organisation. Check your company's rules before you add a personal one.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
