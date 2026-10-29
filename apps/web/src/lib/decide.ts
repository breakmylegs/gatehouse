import type { ClientCommand } from "@gatehouse/shared/ws-protocol"
import { send } from "../store"

/**
 * Sends an allow, deny or answer for a waiting request. Resolves to undefined when the Host took it, or to the
 * sentence to show when it did not. Every place that decides uses this, so they all say the same thing.
 */
export async function decide(cmd: ClientCommand): Promise<string | undefined> {
  const r = await send(cmd)
  if (r.ok) return undefined
  return r.error?.code === "disconnected"
    ? "The Host is not connected, so nothing was sent. The request is still waiting."
    : (r.error?.message ??
        "The Host refused that and gave no reason. The request is still waiting.")
}
