import { LINK_MARK } from "./sessions.js"

/**
 * T-121 (t3code review, O31): a session starts another and waits for it. Starting one is a request you answer (rule
 * agent-start-session), recorded, through the normal start (the org guard, the session limit, the mode set
 * explicitly); the new session works in the same folder in the caller's mode and never in Extreme approval. The
 * caller may then read it and wait for it, as a session named as context (read redacted and as untrusted, T-049).
 */
export const START_RULE = "agent-start-session"
/** The most sessions one session may start. */
export const MAX_CHILDREN = 3
/** The longest a wait lasts, in minutes. */
export const MAX_WAIT_MINUTES = 10

/** A prompt one session wrote for another, without [[session:id]] marks: only your own message names a session to read. */
export const agentPrompt = (text: string): string => text.replace(LINK_MARK, "(a session)")

export interface ChildInfo {
  state: string
}

/** Waits until a session has finished its turn (idle), ended or failed, or the time is up. */
export async function waitForSession(
  info: () => ChildInfo | undefined,
  minutes: number,
  o: { pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ state: string; done: boolean }> {
  const now = o.now ?? Date.now
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const until = now() + Math.min(Math.max(minutes, 0.1), MAX_WAIT_MINUTES) * 60_000
  for (;;) {
    const i = info()
    if (!i) return { state: "closed", done: true }
    if (i.state === "idle" || i.state === "ended" || i.state === "error") return { state: i.state, done: true }
    if (now() >= until) return { state: i.state, done: false }
    await sleep(o.pollMs ?? 2000)
  }
}

type Mode = "default" | "plan" | "acceptEdits" | "auto"

/**
 * Starts a session for one that asked (once you allowed the call): in the same folder, in its mode, never in
 * Extreme approval, at most MAX_CHILDREN from one session. The caller may then read and wait for it; it is recorded,
 * and the prompt loses any [[session:id]] mark, so it cannot name a session for the new one to read.
 */
export async function startChild(
  me:
    | {
        id: string
        cwd: string
        info(): { mode: Mode; model?: string; local?: boolean; account?: string; title?: string; project: string }
        adopt(id: string): void
      }
    | undefined,
  prompt: string,
  title: string | undefined,
  d: {
    counts: Map<string, number>
    start(o: {
      cwd: string
      mode: Mode
      extreme: false
      model?: string
      account?: string
      title: string
    }): Promise<{ id: string; prompt(text: string): void }>
    record(input: Record<string, unknown>): Promise<unknown>
  },
): Promise<{ text: string; isError?: boolean }> {
  if (!me) return { text: "This session is not open.", isError: true }
  if ((d.counts.get(me.id) ?? 0) >= MAX_CHILDREN)
    return { text: `Not started: one session may start at most ${MAX_CHILDREN}.`, isError: true }
  const info = me.info()
  let child
  try {
    child = await d.start({
      cwd: me.cwd,
      mode: info.mode,
      extreme: false,
      ...(info.model && !info.local ? { model: info.model } : {}),
      ...(info.account ? { account: info.account } : {}),
      title: title ?? `From ${info.title ?? info.project}`,
    })
  } catch (e) {
    return { text: `Not started: ${(e as Error).message}`, isError: true }
  }
  d.counts.set(me.id, (d.counts.get(me.id) ?? 0) + 1)
  me.adopt(child.id)
  await d.record({ child: child.id, mode: info.mode, chars: prompt.length })
  child.prompt(agentPrompt(prompt))
  return { text: `Started session ${child.id}. Read it with read_linked_session, or wait for it with wait_for_session.` }
}
