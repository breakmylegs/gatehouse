/**
 * The interface icons from the Codehouse visual identity pack (owner, 2 Nov), drawn from its sprite in
 * public/codehouse/icons.svg. Each takes the colour of the text around it and is hidden from screen readers: the
 * button or label beside it says what it is.
 */
export const ICON_NAMES = [
  "home",
  "new",
  "chat",
  "code",
  "search",
  "projects",
  "memory",
  "prompts",
  "marketplace",
  "usage",
  "audit-log",
  "policy",
  "approver",
  "needs-you",
  "devices",
  "settings",
  "help",
  "more",
  "sidebar-hide",
  "sidebar-show",
  "artifacts",
  "sources",
  "files",
  "changes",
  "terminal",
  "checkpoint",
  "export",
  "copy",
  "pin",
  "archive",
  "rename",
  "close",
  "attach",
  "microphone",
  "send",
  "stop",
  "quick-prompt",
  "manual",
  "plan",
  "accept-edits",
  "auto",
  "extreme",
  "kill-switch",
  "effort",
  "model",
  "local-model",
  "gateway",
  "redaction",
  "phone-approval",
  "push",
  "working",
  "waiting",
  "done",
  "failed",
  "paused",
  "ended",
] as const

export type IconName = (typeof ICON_NAMES)[number]

export const SPRITE = "./codehouse/icons.svg"

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className ? `icon ${className}` : "icon"}
      data-icon={name}
    >
      <use href={`${SPRITE}#${name}`} />
    </svg>
  )
}
