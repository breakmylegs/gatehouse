// Mac fork (owner, 12 Nov): the phone's Liquid Glass navigation. A floating glass tab bar for the three places you go
// (what waits on you, the sessions, settings), with a lens that moves to the one you are on, and the glass back button
// of a screen opened from one of them. The icons are Codehouse's own (docs/brand/interface-icons), drawn inline here
// because the phone is served by the Relay, not the Host. glass.css styles them; App.tsx uses them.

const ICONS = {
  "needs-you": (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
    </>
  ),
  chat: (
    <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.12-1.3l2-1.55-2-3.46-2.4.95a7.2 7.2 0 0 0-2.25-1.3L13.86 3h-3.72l-.37 2.34a7.2 7.2 0 0 0-2.25 1.3l-2.4-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .44.04.87.12 1.3l-2 1.55 2 3.46 2.4-.95a7.2 7.2 0 0 0 2.25 1.3l.37 2.34h3.72l.37-2.34a7.2 7.2 0 0 0 2.25-1.3l2.4.95 2-3.46-2-1.55c.08-.43.12-.86.12-1.3Z" />
    </>
  ),
  back: <path d="m14.5 5-7 7 7 7" />,
}

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

export type Tab = "home" | "sessions" | "settings"

const TABS: Array<{ id: Tab; label: string; icon: keyof typeof ICONS }> = [
  { id: "home", label: "Waiting", icon: "needs-you" },
  { id: "sessions", label: "Sessions", icon: "chat" },
  { id: "settings", label: "Settings", icon: "settings" },
]

/** The tab bar. `waiting` is how many requests wait on you, shown on the first tab. */
export function TabBar({
  active,
  waiting,
  go,
}: {
  active: Tab
  waiting: number
  go: (t: Tab) => void
}) {
  return (
    <nav
      className="tabbar glass"
      aria-label="Codehouse"
      style={{ "--tab": TABS.findIndex((t) => t.id === active) } as React.CSSProperties}
    >
      <span className="tabbar-lens" aria-hidden="true" />
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className="tab"
          aria-current={t.id === active ? "page" : undefined}
          aria-label={t.id === "home" && waiting ? `${t.label}, ${waiting}` : undefined}
          onClick={() => go(t.id)}
        >
          <span className="tab-icon">
            <Icon name={t.icon} />
            {t.id === "home" && waiting ? (
              <span className="tab-badge" aria-hidden="true">
                {waiting > 99 ? "99+" : waiting}
              </span>
            ) : null}
          </span>
          <span className="tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
