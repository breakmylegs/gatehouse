import type {
  CanUseTool,
  ElicitationRequest,
  ElicitationResult,
} from "@anthropic-ai/claude-agent-sdk"

/** The name a URL request is decided under, as if it were a tool call, so the Approver and the audit see it. */
export const OPEN_URL_TOOL = "McpOpenUrl"

/**
 * B06 (MCP 2026-07-28): what Codehouse does when a connected server asks the person for something.
 *
 * - A URL request (a server asking you to sign in on its page) is decided like a tool call, through the same
 *   permission path: the Approver, then you, with the full address shown, and recorded. Codehouse never opens the
 *   address itself: accepting tells the server you will, and you open it from the request.
 * - Only a plain https address is offered; anything else is declined.
 * - A form request is declined: Codehouse has no safe way to fill a server's form for you.
 * - In Extreme approval, which never waits for you, a URL request is declined, because only you can open the page.
 * - Anything that goes wrong declines (invariant 1).
 */
export async function decideElicitation(
  req: ElicitationRequest,
  deps: { canUse: CanUseTool; extreme: () => boolean; log: (line: string) => void },
  signal: AbortSignal = new AbortController().signal,
): Promise<ElicitationResult> {
  try {
    if (req.mode !== "url" || !req.url) return { action: "decline" }
    if (deps.extreme()) return { action: "decline" }
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return { action: "decline" }
    }
    if (url.protocol !== "https:" || url.username || url.password) return { action: "decline" }
    const decision = await deps.canUse(
      OPEN_URL_TOOL,
      { server: req.serverName, url: url.href, message: req.message.slice(0, 2000) },
      {
        signal,
        toolUseID: `elicit-${req.elicitationId ?? crypto.randomUUID()}`,
        suggestions: [],
      } as unknown as Parameters<CanUseTool>[2],
    )
    return decision?.behavior === "allow" ? { action: "accept" } : { action: "decline" }
  } catch (e) {
    deps.log(`an elicitation could not be decided (${(e as Error).name}), so it was declined`)
    return { action: "decline" }
  }
}
