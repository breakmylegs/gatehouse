import clsx from "clsx"
import { useEffect, useRef, useState } from "react"
import { notifyLine } from "../lib/rail"
import { titleOf } from "../lib/sessionActions"
import { MAIN_ACCOUNT, send, useSessionList, useStore } from "../store"
import { AccountsDialog } from "./AccountsDialog"
import { Menu } from "./Menu"
import { openPalette } from "./Rail"
import { SessionCode } from "./SessionCode"
import { Icon, type IconName } from "./Icon"
import { keyLabel, systemName } from "../lib/platform-mac" // Mac fork
import { Disclosure } from "./DisclosureMac" // Mac fork

/** A session's state in a word and a small icon, for the strip (owner, 3 Nov: icons for state, not words). */
function stateWord(s: {
  state: string
  paused?: unknown
  background?: string[]
}): { text: string; tone: string; icon: IconName } | undefined {
  if (s.paused) return { text: "Paused", tone: "is-warn", icon: "paused" }
  if (s.state === "waiting") return { text: "Needs you", tone: "is-warn", icon: "needs-you" }
  if (s.state === "running" || (s.state === "idle" && s.background?.length))
    return { text: "Working", tone: "is-run", icon: "working" }
  if (s.state === "starting") return { text: "Starting", tone: "", icon: "waiting" }
  if (s.state === "error") return { text: "Stopped", tone: "is-sev", icon: "failed" }
  if (s.state === "idle") return { text: "Ready", tone: "", icon: "done" }
  return undefined
}

/**
 * The command deck across the top (Stitch, owner 1 Nov): the wordmark, every live session with its state, the phone,
 * the kill switch and your profile menu. The kill switch asks once before it acts; Ctrl+Shift+K opens that question.
 */
export function CommandDeck() {
  const setRoute = useStore((s) => s.setRoute)
  const selectSession = useStore((s) => s.selectSession)
  const health = useStore((s) => s.health)
  const live = useSessionList().filter((s) => s.state !== "ended")
  const killed = health?.killSwitch.engaged ?? false
  const [confirmKill, setConfirmKill] = useState(false)
  const killButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const ask = () => setConfirmKill(true)
    window.addEventListener("codeh:kill", ask)
    return () => window.removeEventListener("codeh:kill", ask)
  }, [])
  const phone = health ? notifyLine(health) : undefined

  return (
    <header className="deck shell" aria-label="Command deck">
      {/* The name goes Home, the start screen, as a name at the top left does in most apps. */}
      <button
        type="button"
        className="deck-brand"
        title="Home"
        aria-label="Codehouse, Powered by Claude: go to Home"
        onClick={() => setRoute("home")}
      >
        <strong className="sign">Codehouse</strong>
        <span className="deck-sub">
          Codehouse <span className="deck-claude">Powered by Claude</span>
        </span>
      </button>

      <div className="deck-sessions" role="group" aria-label="Live sessions">
        {live.map((s) => {
          const w = stateWord(s)
          return (
            <button
              key={s.id}
              type="button"
              className="deck-chip"
              aria-label={`Open ${titleOf(s)}${w ? `, ${w.text}` : ""}`}
              onClick={() => {
                selectSession(s.id)
                setRoute("workspace")
              }}
            >
              <SessionCode session={s} className="!text-[12px]" />
              {w ? (
                <span className={clsx("deck-state", w.tone)} title={w.text}>
                  <Icon
                    name={w.icon}
                    size={13}
                    className={w.icon === "working" ? "state-spin" : undefined}
                  />
                </span>
              ) : null}
            </button>
          )
        })}
        {live.length === 0 ? <span className="deck-none">No sessions running</span> : null}
      </div>

      <div className="deck-end">
        {phone ? (
          <span className="deck-phone">
            <span aria-hidden="true" className={clsx("deck-dot", phone.ok && "is-ok")} />
            {phone.label}
          </span>
        ) : null}
        {killed ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void send({ type: "rearm" })}
          >
            Re-arm sessions
          </button>
        ) : (
          <span className="relative">
            <button
              ref={killButton}
              type="button"
              className="kill-switch"
              aria-label="Kill switch"
              aria-expanded={confirmKill}
              onClick={() => setConfirmKill((v) => !v)}
            >
              <Icon name="kill-switch" className="kill-icon" />
              Stop everything
              <kbd aria-hidden="true">{keyLabel("Ctrl Shift K")}</kbd>
            </button>
            {confirmKill ? (
              <div
                role="group"
                aria-label="Confirm the kill switch"
                className="kill-confirm"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setConfirmKill(false)
                    killButton.current?.focus()
                  }
                }}
              >
                <strong>Deny everything and stop new sessions?</strong>
                <span className="text-[13px] text-shell-mut">
                  Every turn and background task stops, and every request is denied until you
                  re-arm.
                </span>
                {live.length ? (
                  <ul className="kill-list" aria-label="Sessions that stop">
                    {live.map((s) => {
                      const w = stateWord(s)
                      return (
                        <li key={s.id}>
                          <SessionCode session={s} className="!text-[12px]" />
                          <span className="min-w-0 truncate">{titleOf(s)}</span>
                          {w ? <span className={clsx("deck-state", w.tone)}>{w.text}</span> : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <span className="text-[13px]">No session is running now.</span>
                )}
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-deny"
                    onClick={() => {
                      setConfirmKill(false)
                      void send({ type: "kill" })
                    }}
                  >
                    Yes, stop everything
                  </button>
                  <button
                    type="button"
                    className="btn"
                    autoFocus
                    onClick={() => {
                      setConfirmKill(false)
                      killButton.current?.focus()
                    }}
                  >
                    Cancel <kbd aria-hidden="true">Esc</kbd>
                  </button>
                </span>
              </div>
            ) : null}
          </span>
        )}
        <ProfileMenu />
      </div>
    </header>
  )
}

/** Your profile: accounts, every other page, the theme and help. */
function ProfileMenu() {
  const health = useStore((s) => s.health)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const themeFollows = useStore((s) => s.themeFollows)
  const followSystem = useStore((s) => s.followSystem)
  const setRoute = useStore((s) => s.setRoute)
  const helpOpen = useStore((s) => s.helpOpen)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const activeAccount = useStore((s) => s.activeAccount)
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const [managing, setManaging] = useState(false)
  useEffect(() => {
    const open = () => setManaging(true)
    window.addEventListener("codeh:accounts", open)
    return () => window.removeEventListener("codeh:accounts", open)
  }, [])
  const accounts = health?.accounts ?? []
  // The account on show is the one named here; the main one's sign-in is the one Health has always carried.
  const shown = accounts.find((a) => a.id === activeAccount)
  const signin =
    shown && shown.id !== MAIN_ACCOUNT
      ? { signedIn: shown.signedIn, email: shown.email, organization: shown.organization }
      : health?.signin
  const who = signin?.signedIn
    ? (signin.email?.split("@")[0] ?? "Signed in")
    : health
      ? "Not signed in"
      : "Connecting"
  return (
    <>
      {managing ? <AccountsDialog onClose={() => setManaging(false)} /> : null}
      <Menu
        label={`Your profile and settings: ${who}`}
        className="deck-profile"
        align="end"
        tone="shell"
        button={
          <>
            <span aria-hidden="true" className="deck-avatar">
              {who.slice(0, 1).toUpperCase()}
            </span>
            <span className="grid min-w-0 text-left">
              <span className="truncate font-semibold">{who}</span>
              {signin?.organization ? (
                <span className="truncate text-[11.5px] text-shell-mut">{signin.organization}</span>
              ) : null}
            </span>
            <Disclosure open />
          </>
        }
        items={[
          ...(signin?.email ? [{ kind: "heading" as const, label: signin.email }] : []),
          // Each account, the one on show ticked; choosing one shows its sessions and stops nothing.
          ...(accounts.length > 1
            ? accounts.map((a) => ({
                label: `${a.label}${a.email ? `, ${a.email}` : ""}`,
                checked: a.id === activeAccount,
                onSelect: () => setActiveAccount(a.id),
              }))
            : []),
          { label: "Accounts...", onSelect: () => setManaging(true) },
          { kind: "separator" as const },
          { label: "Settings", onSelect: () => setRoute("settings") },
          { label: "What Claude may do", onSelect: () => setRoute("policy") },
          { label: "Approver", onSelect: () => setRoute("approver") },
          { label: "Audit log", onSelect: () => setRoute("audit") },
          { label: "Phone and notifications", onSelect: () => setRoute("devices") },
          { kind: "separator" },
          {
            label: theme === "dark" ? "Codehouse light" : "Codehouse dark",
            onSelect: () => setTheme(theme === "dark" ? "light" : "dark"),
          },
          ...(themeFollows
            ? []
            : [{ label: `Follow ${systemName()} theme`, onSelect: followSystem }]), // Mac fork
          { label: "Help for this page", hint: "F1", onSelect: () => setHelpOpen(!helpOpen) },
          { label: "User guide", onSelect: () => setRoute("guide") },
          { label: "Search and commands", hint: "Ctrl K", onSelect: openPalette },
        ]}
      />
    </>
  )
}
