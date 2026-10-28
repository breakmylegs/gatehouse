import { useEffect, useRef, useState } from "react"
import { OrgForm, SignInPanel } from "../components/SetupParts"
import { send, useStore } from "../store"
import { Check } from "./FirstRun"

const STEPS = ["Welcome", "Sign in", "Organisation", "Your choices", "Finish"] as const

/**
 * The first-launch wizard: sign in, set the organisation, choose a theme, then start. Each step that needs
 * something will not move on until it is true, and the whole thing can be skipped or run again from Settings.
 */
export function Setup() {
  const [step, setStep] = useState(0)
  const [checking, setChecking] = useState(false)
  const health = useStore((s) => s.health)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const jcMode = useStore((s) => s.jcMode)
  const setJcMode = useStore((s) => s.setJcMode)
  const setRoute = useStore((s) => s.setRoute)
  const setSetupDone = useStore((s) => s.setSetupDone)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [step])

  const s = health?.signin
  const signedIn = s?.signedIn ?? false
  const orgOk = s?.orgOk ?? false
  const canNext = step === 1 ? signedIn : step === 2 ? orgOk : true

  const finish = (to: "sessions" | "approvals") => {
    setSetupDone(true)
    setRoute(to)
  }

  async function checkAgain() {
    setChecking(true)
    await send({ type: "refresh_account" }, 120_000)
    setChecking(false)
  }

  return (
    <div className="mx-auto grid max-w-[720px] gap-4 p-6">
      <ol
        aria-label="Setup steps"
        className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px]"
      >
        {STEPS.map((name, i) => (
          <li
            key={name}
            aria-current={i === step ? "step" : undefined}
            className={i === step ? "font-semibold" : "text-mut"}
          >
            {i + 1}. {name}
          </li>
        ))}
      </ol>

      <h1 ref={heading} tabIndex={-1} className="m-0 text-[22px] font-semibold outline-none">
        {step === 0 && "Welcome to Jean-Claude Van Code"}
        {step === 1 && "Sign in to Claude"}
        {step === 2 && "Check your organisation"}
        {step === 3 && "Your choices"}
        {step === 4 && "You are ready"}
      </h1>

      {step === 0 && (
        <div className="grid gap-2">
          <p className="m-0">
            This app runs Claude on your computer and keeps you in charge. Safe, low-risk requests
            are decided for you. Anything else waits for you here, and on your phone if you pair
            one.
          </p>
          <p className="m-0 text-mut">
            Setup takes about a minute: sign in, confirm your organisation, pick how it looks, and
            start.
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-3">
          <p className="m-0">
            It uses your own Claude account, the same one Claude Code uses. Nothing is stored by
            this app.
          </p>
          <SignInPanel />
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-3">
          <p className="m-0">
            Sessions only start if the account you signed in with belongs to the organisation you
            expect. This stops a personal account being used by mistake.
          </p>
          {orgOk ? (
            <p role="status" className="m-0 font-semibold text-ok">
              Organisation matches{s?.organization ? `: ${s.organization}` : ""}.
            </p>
          ) : (
            <>
              {s?.orgMessage ? <p className="m-0 text-mut">{s.orgMessage}</p> : null}
              <OrgForm />
              <div>
                <button className="btn" disabled={checking} onClick={() => void checkAgain()}>
                  {checking ? "Checking..." : "Check again"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-4">
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">Theme</legend>
            {(["light", "dark"] as const).map((t) => (
              <label key={t} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="theme"
                  checked={theme === t}
                  onChange={() => setTheme(t)}
                />
                {t === "light" ? "Light" : "Dark"}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={jcMode} onChange={(e) => setJcMode(e.target.checked)} />
            Jean-Claude mode: show the extra pictures (optional)
          </label>
          <p className="m-0 text-xs text-mut">
            When a request needs you and the window is behind others, the taskbar button flashes.
            Phone pairing is optional and can be done later from Devices.
          </p>
        </div>
      )}

      {step === 4 && (
        <div className="grid gap-3">
          <ul
            className="m-0 list-none divide-y divide-line border-y border-line p-0"
            aria-label="Checks"
          >
            <Check ok={signedIn} title="Signed in to Claude">
              {signedIn ? `Signed in as ${s?.email ?? "your account"}.` : "Not signed in yet."}
            </Check>
            <Check ok={orgOk} title="Organisation matches">
              {orgOk
                ? `Organisation: ${s?.organization ?? "unknown"}.`
                : (s?.orgMessage ?? "Not set yet.")}
            </Check>
            <Check ok={health?.approver.state === "up"} title="Approver running">
              {health?.approver.state === "up"
                ? "The Approver is deciding low-risk requests."
                : "It has not started. Requests will all wait for you until it does."}
            </Check>
          </ul>
          <p className="m-0 text-mut">
            Tip: start your first session in a scratch folder, not a real project, to see how
            approvals feel.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {step > 0 ? (
          <button className="btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
            {step === 0 ? "Get started" : "Next"}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!(signedIn && orgOk)}
            onClick={() => finish("sessions")}
          >
            Start my first session
          </button>
        )}
        <button className="btn ml-auto" onClick={() => finish("approvals")}>
          Skip setup
        </button>
      </div>
      {!canNext ? (
        <p role="status" className="m-0 text-xs text-mut">
          {step === 1 ? "Sign in to continue." : "Set your organisation to continue."}
        </p>
      ) : null}
    </div>
  )
}
