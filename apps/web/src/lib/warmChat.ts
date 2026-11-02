import { send } from "../store"

/** How often to tell the Host a chat is still wanted; it puts the warm chat away after three minutes without. */
export const WARM_PING_MS = 60_000

/**
 * While New chat or the quick prompt is open, asks the Host to keep a chat ready (the warm chat), so the first message
 * does not wait for Claude Code to start. Returns how to stop asking. Nothing is shown if the Host says no.
 */
export function keepChatWarm(): () => void {
  const ask = () => void send({ type: "warm_chat" }).catch(() => undefined)
  ask()
  const timer = setInterval(ask, WARM_PING_MS)
  return () => clearInterval(timer)
}
