import type { ProviderAdapter, ProviderCapabilities, ProviderId } from "./types.js"

/** The provider every session uses today, and the only one listed while multi-provider is off. */
export const CLAUDE_PROVIDER: ProviderId = "claude-agent-sdk"

export class ProviderRefused extends Error {
  constructor(
    readonly provider: ProviderId,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Vendor settings that let an agent approve calls by itself, by any name a vendor uses (invariant 3). A setting is
 * matched on its name and its value, so `approval: "never"` and `yolo: true` are both refused.
 */
const BYPASS_NAMES =
  /bypass|yolo|dangerously|skip.?permission|auto.?approve|always.?approve|full.?auto/i
const BYPASS_VALUES =
  /^(bypasspermissions|dontask|never|yolo|full-auto|always-approve|auto-approve)$/i

/** Why these capabilities are refused, or undefined when they may be registered. */
export function bypassIn(c: ProviderCapabilities): string | undefined {
  for (const [name, value] of Object.entries(c.vendorSettings)) {
    if (BYPASS_NAMES.test(name) && value !== false)
      return `its vendor setting ${name} lets it approve calls by itself`
    if (typeof value === "string" && BYPASS_VALUES.test(value.trim()))
      return `its vendor setting ${name} = ${value} lets it approve calls by itself`
  }
  if (c.pattern === "loop" && Object.keys(c.vendorSettings).length)
    return "a loop adapter runs no vendor agent, so it has no vendor settings"
  return undefined
}

/**
 * The providers Codehouse knows (S-01). Registering checks the adapter can never approve by itself; listing shows only
 * Claude's until multi-provider is switched on in settings.
 */
export class ProviderRegistry {
  readonly #adapters = new Map<ProviderId, ProviderAdapter>()
  readonly #enabled: () => boolean

  constructor(enabled: () => boolean) {
    this.#enabled = enabled
  }

  register(adapter: ProviderAdapter): void {
    if (this.#adapters.has(adapter.id))
      throw new ProviderRefused(adapter.id, `${adapter.id} is registered already.`)
    let caps: ProviderCapabilities
    try {
      caps = adapter.capabilities()
    } catch {
      throw new ProviderRefused(adapter.id, `${adapter.id} did not say what it can do.`)
    }
    const why = bypassIn(caps)
    if (why) throw new ProviderRefused(adapter.id, `${adapter.id} is refused: ${why}.`)
    if (caps.webSearch !== "app-tool" && caps.webSearch !== "none")
      throw new ProviderRefused(
        adapter.id,
        `${adapter.id} is refused: a vendor's hosted search is never used.`,
      )
    this.#adapters.set(adapter.id, adapter)
  }

  /** The providers a session may use now. */
  list(): ProviderAdapter[] {
    const all = [...this.#adapters.values()]
    return this.#enabled() ? all : all.filter((a) => a.id === CLAUDE_PROVIDER)
  }

  get(id: ProviderId): ProviderAdapter | undefined {
    return this.list().find((a) => a.id === id)
  }
}
