/**
 * A model runtime on this computer (ADR 0011): Ollama, or any server that speaks the OpenAI chat completions API
 * (llama.cpp's llama-server, LM Studio). Codehouse never installs or updates one; IT does. Before it is used:
 * - it must listen on this computer only (127.0.0.1, localhost or ::1), and Codehouse never follows a redirect away from it;
 * - Ollama must be 0.17.1 or newer (CVE-2026-7482, a heap read in its model loader, is fixed there);
 * - only models you listed are offered, and a model listed with a digest only if the runtime's copy matches it.
 * No credential is involved: a local runtime has none, so invariant 6 is untouched.
 *
 * A gateway (ADR 0010, decided 2 Nov) is the same kind of server on this computer, run by your organisation (LiteLLM,
 * an Azure API Management gateway, an IT agent), that forwards to a hosted provider and holds that provider's
 * credentials itself. Codehouse sends it no key, token or password, ever: invariant 6 stays as written. What Codehouse sends
 * has the redaction list applied first, as for any runtime, and the window says where the words go.
 */

export interface LocalModel {
  name: string
  /** sha256 of the model, as Ollama reports it; when given, only that exact copy is used. */
  digest?: string
}

export interface LocalRuntimeConfig {
  kind: "ollama" | "openai-compatible" | "gateway"
  url: string
  models: LocalModel[]
  /** For a gateway: the provider it forwards to, as you name it (shown, never checked). */
  forwardsTo?: string
  /** For a gateway: what that provider keeps of what is sent, as your agreement with it says. */
  keeps?: "nothing" | "30-days" | "unknown"
}

/** The settings a runtime may have. Anything else, a key or a password above all, is refused when saved. */
export const RUNTIME_FIELDS = new Set(["kind", "url", "models", "forwardsTo", "keeps"])

/** Where a chat on this runtime sends its words, in the window's words. */
export function runtimeLabel(cfg: Pick<LocalRuntimeConfig, "kind" | "forwardsTo">): string {
  if (cfg.kind !== "gateway") return "On this computer"
  return `${cfg.forwardsTo?.trim() || "A hosted model"} through your gateway`
}

export type RuntimeCheck =
  | { ok: true; models: string[]; version?: string; left: Array<{ name: string; why: string }> }
  | { ok: false; code: string; reason: string }

export const OLLAMA_MIN_VERSION = "0.17.1"
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
export const MODEL_NAME = /^[\w.:/-]{1,100}$/

/** Why this address is refused, or undefined when it is on this computer. */
export function addressProblem(url: string): string | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return "That is not a web address."
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Use an http address."
  if (!LOOPBACK.has(u.hostname)) return "A model runtime must be on this computer (127.0.0.1)."
  if (u.username || u.password) return "The address must not carry a name or password."
  return undefined
}

/** True when version a is at least b, comparing numbers part by part. */
export function atLeast(a: string, b: string): boolean {
  const pa = a
    .replace(/^v/, "")
    .split(/[.-]/)
    .map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return true
}

const base = (url: string) => url.replace(/\/+$/, "")
const plainDigest = (d: string) => d.replace(/^sha256:/i, "").toLowerCase()

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`${res.status}`)
  return (await res.json()) as unknown
}

/**
 * B19: a model's licence, as an Ollama runtime on this computer reports it, so you can read it before you use the
 * model. Undefined when the runtime is not Ollama, is elsewhere, or says none. At most 50,000 characters.
 */
export async function modelLicence(
  cfg: LocalRuntimeConfig,
  model: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  if (cfg.kind !== "ollama" || addressProblem(cfg.url)) return undefined
  if (!cfg.models.some((m) => m.name === model)) return undefined
  try {
    const res = await fetchFn(`${base(cfg.url)}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return undefined
    const v = (await res.json()) as { license?: unknown }
    return typeof v.license === "string" && v.license.trim()
      ? v.license.slice(0, 50_000)
      : undefined
  } catch {
    return undefined
  }
}

/** Checks the runtime before a session uses it: where it listens, its version, and which listed models it has. */
export async function checkRuntime(
  cfg: LocalRuntimeConfig,
  fetchFn: typeof fetch = fetch,
): Promise<RuntimeCheck> {
  const bad = addressProblem(cfg.url)
  if (bad) return { ok: false, code: "runtime.non-loopback", reason: bad }
  if (!cfg.models.length)
    return {
      ok: false,
      code: "runtime.no-models",
      reason: "List the models Codehouse may use first.",
    }
  const left: Array<{ name: string; why: string }> = []
  try {
    if (cfg.kind === "ollama") {
      const v = (await getJson(fetchFn, `${base(cfg.url)}/api/version`)) as { version?: unknown }
      const version = typeof v.version === "string" ? v.version : ""
      if (!version || !atLeast(version, OLLAMA_MIN_VERSION))
        return {
          ok: false,
          code: "runtime.version",
          reason: `Ollama ${version || "of an unknown version"} is too old: ${OLLAMA_MIN_VERSION} or newer is needed (CVE-2026-7482).`,
        }
      const tags = (await getJson(fetchFn, `${base(cfg.url)}/api/tags`)) as { models?: unknown }
      const have = new Map<string, string>()
      for (const m of Array.isArray(tags.models) ? tags.models : []) {
        const o = m as { name?: unknown; digest?: unknown }
        if (typeof o.name === "string")
          have.set(o.name, typeof o.digest === "string" ? plainDigest(o.digest) : "")
      }
      const models: string[] = []
      for (const m of cfg.models) {
        const d = have.get(m.name)
        if (d === undefined) left.push({ name: m.name, why: "the runtime does not have it" })
        else if (m.digest && plainDigest(m.digest) !== d)
          left.push({ name: m.name, why: "its copy does not match the digest you listed" })
        else models.push(m.name)
      }
      return models.length
        ? { ok: true, models, version, left }
        : { ok: false, code: "runtime.no-models", reason: "None of the listed models can be used." }
    }
    const list = (await getJson(fetchFn, `${base(cfg.url)}/v1/models`)) as { data?: unknown }
    const ids = new Set(
      (Array.isArray(list.data) ? list.data : [])
        .map((m) => (m as { id?: unknown }).id)
        .filter((id): id is string => typeof id === "string"),
    )
    const models: string[] = []
    for (const m of cfg.models) {
      if (!ids.has(m.name)) left.push({ name: m.name, why: "the runtime does not have it" })
      else if (m.digest)
        left.push({ name: m.name, why: "this kind of runtime cannot show a digest to check" })
      else models.push(m.name)
    }
    return models.length
      ? { ok: true, models, left }
      : { ok: false, code: "runtime.no-models", reason: "None of the listed models can be used." }
  } catch {
    return { ok: false, code: "runtime.unreachable", reason: "Nothing answered at that address." }
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

export interface ChatReply {
  text: string
  toolCalls: Array<{ id: string; name: string; arguments: string }>
  usage: { input: number; output: number }
}

/** One request to the runtime's chat completions API, never streaming, never following a redirect. */
export async function chatOnce(
  cfg: LocalRuntimeConfig,
  body: { model: string; messages: ChatMessage[]; tools: unknown[] },
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<ChatReply> {
  const bad = addressProblem(cfg.url)
  if (bad) throw new Error(bad)
  const res = await fetchFn(`${base(cfg.url)}/v1/chat/completions`, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...body,
      stream: false,
      ...(body.tools.length ? {} : { tools: undefined }),
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
  })
  if (!res.ok) throw new Error(`The model runtime answered ${res.status}.`)
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
  }
  const m = json.choices?.[0]?.message ?? {}
  const calls = Array.isArray(m.tool_calls) ? m.tool_calls : []
  return {
    text: typeof m.content === "string" ? m.content : "",
    toolCalls: calls.flatMap((c, i) => {
      const o = c as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }
      const name = o.function?.name
      if (typeof name !== "string") return []
      const args = o.function?.arguments
      return [
        {
          id: typeof o.id === "string" && o.id ? o.id : `call_${Date.now()}_${i}`,
          name,
          arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
        },
      ]
    }),
    usage: {
      input: typeof json.usage?.prompt_tokens === "number" ? json.usage.prompt_tokens : 0,
      output: typeof json.usage?.completion_tokens === "number" ? json.usage.completion_tokens : 0,
    },
  }
}
