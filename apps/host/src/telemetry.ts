import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/**
 * B36: a local OpenTelemetry export of Codehouse's decisions, for your own dashboards. Off unless you switch it on in
 * Settings. Each decision is one span in OTLP/JSON: written to a file in the data folder, sent to a collector on this
 * computer, or both. A span says which tool, what was decided, by which rule, at what risk, by whom and how long it
 * took; it never holds a prompt, a command, a path, a file name or a project name.
 */
export interface TelemetrySettings {
  file?: boolean
  /** A collector on this computer only, such as http://127.0.0.1:4318/v1/traces. */
  endpoint?: string
}

/** Only an address on this computer is accepted for the collector. */
export const LOOPBACK_COLLECTOR =
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}(\/[A-Za-z0-9._~\/-]*)?$/

export interface DecisionSpan {
  name: string
  session: string
  outcome: string
  rule: string
  risk: number
  decidedBy: string
  tool?: string
  channel?: string
  latencyMs?: number
}

const attr = (key: string, v: string | number) =>
  typeof v === "number"
    ? { key, value: { intValue: String(Math.round(v)) } }
    : { key, value: { stringValue: v } }

/** One span as an OTLP/JSON ExportTraceServiceRequest. */
export function otlpOf(span: DecisionSpan, now = Date.now()): Record<string, unknown> {
  const end = BigInt(now) * 1_000_000n
  const start = end - BigInt(Math.max(0, Math.round(span.latencyMs ?? 0))) * 1_000_000n
  // The session is hashed into the trace id, so one session's decisions line up, without naming anything.
  const traceId = crypto.createHash("sha256").update(span.session).digest("hex").slice(0, 32)
  return {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", "codehouse")] },
        scopeSpans: [
          {
            scope: { name: "codehouse.decisions" },
            spans: [
              {
                traceId,
                spanId: crypto.randomBytes(8).toString("hex"),
                name: span.name,
                kind: 1,
                startTimeUnixNano: start.toString(),
                endTimeUnixNano: end.toString(),
                attributes: [
                  attr("codehouse.outcome", span.outcome),
                  attr("codehouse.rule", span.rule),
                  attr("codehouse.risk", span.risk),
                  attr("codehouse.decided_by", span.decidedBy),
                  ...(span.tool ? [attr("codehouse.tool", span.tool)] : []),
                  ...(span.channel ? [attr("codehouse.channel", span.channel)] : []),
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

/** Tool names are kept as they are, except an MCP tool's, which keeps only its server, since its name can say more. */
export const toolLabel = (tool: string): string =>
  tool.startsWith("mcp__") ? `mcp__${tool.split("__")[1] ?? "server"}` : tool.slice(0, 60)

export interface TelemetryDeps {
  /** Where the trace files go: telemetry in the data folder. */
  dir: string
  settings: () => TelemetrySettings | undefined
  fetchFn?: typeof fetch
  log: (line: string) => void
  now?: () => number
}

export class Telemetry {
  readonly #d: TelemetryDeps

  constructor(d: TelemetryDeps) {
    this.#d = d
  }

  /** Exports one decision as the settings say; nothing when it is off. Never throws and never waits. */
  span(span: DecisionSpan): void {
    const s = this.#d.settings()
    if (!s || (!s.file && !s.endpoint)) return
    try {
      const now = (this.#d.now ?? Date.now)()
      const body = JSON.stringify(
        otlpOf({ ...span, ...(span.tool ? { tool: toolLabel(span.tool) } : {}) }, now),
      )
      if (s.file) {
        fs.mkdirSync(this.#d.dir, { recursive: true })
        const day = new Date(now).toISOString().slice(0, 10)
        fs.appendFileSync(path.join(this.#d.dir, `traces-${day}.jsonl`), body + "\n")
      }
      if (s.endpoint && LOOPBACK_COLLECTOR.test(s.endpoint))
        void (this.#d.fetchFn ?? fetch)(s.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(2000),
        }).catch(() => undefined)
    } catch (e) {
      this.#d.log(`telemetry export failed (${(e as Error).name})`)
    }
  }
}
