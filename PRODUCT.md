# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing decision from docs/BUILD_SPEC.md: Vite and React (apps/web) served locally by the Host, Tailwind CSS, zustand, Virtuoso, recharts, Sonner. The phone app is a PWA in apps/phone.

## Users

One senior technology architect running several Claude agent sessions at once across client and internal projects. They switch context constantly and often decide from an iPhone away from the desk.

Source: BUILD_SPEC "Product context for /impeccable init". The interview was not run because the owner is away and said to work without questions. Every fact here is taken from the spec, none is invented.

## Product Purpose

Run Claude agent sessions locally and decide quickly and safely what they may do. Most decisions are automatic. The interface exists for the few that are not. Success is a correct decision in seconds, and trust that the automatic ones were right.

Jobs: see what needs me now; understand exactly what will run, where and why it was escalated; decide in seconds without mistakes; trust that automatic decisions were right; tune the policy over time.

## Positioning

A permission workbench, not a chat client. Every decision carries a rule id, a risk score and an audit record, and the same request reaches the desktop and the phone at once, first valid answer wins. Sessions run on the owner's own SSO sign-in through the unmodified Claude Code binary.

## Operating Context

- Desktop web app on Windows 11 in Edge or Chrome, 1366 to 1920 pixels wide, primary 1440 by 900.
- Companion iPhone PWA at 390 by 844, added to the Home Screen, decisions confirmed with Face ID.
- Many sessions at once, some escalations arriving while the user types in a composer.

## Capabilities and Constraints

- Surfaces, in order: approval card and queue; session workspace; sessions overview; policy studio; audit log; devices and pairing; settings; first run; phone app.
- Permission modes are default and plan only. The phone can allow, deny, answer questions and trigger the kill switch. It cannot edit inputs, change policy or create remember rules.
- Approval actions: allow once, deny, deny with a message, edit then allow (desktop only), stop session, remember (desktop only, shows the exact rule it creates).
- Allow needs a deliberate chord (Ctrl+Enter). Allow is never the default focus at risk 70 or above. Deny is always one step. New escalations never steal focus from the composer.
- Terminology: "Approver", "Host", "Relay", "escalate", "rule id", "risk band", "remember rule", "kill switch".
- Branding: not named or styled as Claude Code or claude.ai, no Anthropic logos. "Powered by Claude" is allowed.

## Brand Commitments

Product name: Gatehouse. Voice: plain, precise UK English in sentence case, no em dashes, no hype. No hover tooltips; explanations sit in visible text or a panel.

## Evidence on Hand

Real policy rules in policy/rules.yaml, 489 golden policy cases in packages/policy/test/golden, and a live Host with a WebSocket protocol in packages/shared/src/ws-protocol.ts. There are no customer quotes, screenshots or brand assets, and none may be invented.

## Product Principles

1. Decisions first.
2. Show the real command, never a paraphrase.
3. Calm by default, urgent only when it matters.
4. Allowing is deliberate, denying is easy.
5. Every automatic decision is explainable.
6. Keyboard first on desktop, thumb first on phone.

Anti-goals: not a chat toy, not a clone of Claude Code or claude.ai, no marketing gloss, no gamification.

## Accessibility & Inclusion

WCAG 2.2 AA in light and dark themes. Risk is never shown by colour alone. Respect reduced motion. Full keyboard operation.
