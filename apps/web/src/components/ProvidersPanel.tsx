import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface LocalRuntime {
  kind: "ollama" | "openai-compatible" | "gateway"
  url: string
  models: Array<{ name: string; digest?: string }>
  forwardsTo?: string
  keeps?: "nothing" | "30-days" | "unknown"
}
type Check =
  | { ok: true; models: string[]; version?: string; left: Array<{ name: string; why: string }> }
  | { ok: false; code: string; reason: string }
interface ProvidersView {
  enabled: boolean
  local?: LocalRuntime
  check?: Check
}

/** "name" or "name sha256:digest", one a line. */
function parseModels(text: string): LocalRuntime["models"] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name = "", digest] = l.split(/\s+/)
      return digest ? { name, digest } : { name }
    })
}

/**
 * Settings: other AI providers (ADR 0011). For now a model runtime on this computer, which IT installs (Codehouse never
 * downloads one), and the models you allow. Chats on it are in Plan mode with read-only tools, and every tool call
 * goes to the Approver as Claude's do. `onSaved` tells the settings page, so its next save keeps this.
 */
export function ProvidersPanel({ onSaved }: { onSaved?: (providers: unknown) => void }) {
  const [view, setView] = useState<ProvidersView>()
  const [enabled, setEnabled] = useState(false)
  const [kind, setKind] = useState<LocalRuntime["kind"]>("ollama")
  const [url, setUrl] = useState("http://127.0.0.1:11434")
  const [models, setModels] = useState("")
  const [forwardsTo, setForwardsTo] = useState("")
  const [keeps, setKeeps] = useState<NonNullable<LocalRuntime["keeps"]>>("unknown")
  const gateway = kind === "gateway"
  const [busy, setBusy] = useState(false)

  const show = (v: ProvidersView) => {
    setView(v)
    setEnabled(v.enabled)
    if (v.local) {
      setKind(v.local.kind)
      setUrl(v.local.url)
      setForwardsTo(v.local.forwardsTo ?? "")
      setKeeps(v.local.keeps ?? "unknown")
      setModels(v.local.models.map((m) => (m.digest ? `${m.name} ${m.digest}` : m.name)).join("\n"))
    }
  }
  useEffect(() => {
    void api<ProvidersView>("GET", "/api/providers").then((r) => r.ok && r.data && show(r.data))
  }, [])

  async function save() {
    setBusy(true)
    const list = parseModels(models)
    const r = await api<ProvidersView>("PUT", "/api/providers", {
      enabled,
      ...(list.length
        ? {
            local: {
              kind,
              url: url.trim(),
              models: list,
              ...(gateway ? { forwardsTo: forwardsTo.trim(), keeps } : {}),
            },
          }
        : {}),
    })
    setBusy(false)
    if (!r.ok || !r.data) {
      toast.error(r.errors?.[0] ?? r.error ?? "Not saved", { id: "settings" })
      return
    }
    show(r.data)
    onSaved?.({
      multi: { enabled: r.data.enabled },
      ...(r.data.local ? { local: r.data.local } : {}),
    })
    toast("Other AI providers saved", { id: "settings" })
  }

  const check = view?.check
  return (
    <>
      <p className="m-0 text-xs text-mut">
        Chat with a model that runs on this computer instead of Claude: Ollama, or a server that
        speaks the OpenAI chat API (llama.cpp, LM Studio). IT installs it; Codehouse never downloads
        one. It must listen on this computer only, Ollama must be 0.17.1 or newer, and only the
        models you list are offered. Chats on it are in Plan mode with read-only tools, and every
        tool call goes to the Approver, as Claude&apos;s do. Nothing goes to another company.
      </p>
      <p className="m-0 text-xs text-mut">
        Or a hosted model (Azure OpenAI and others) through your organisation&apos;s gateway on this
        computer (LiteLLM, an Azure API Management gateway or an IT agent). The gateway holds the
        provider&apos;s credentials; Codehouse sends it no key or password, ever. Your words then
        leave this computer through it, with your redaction list applied first, and the chat says
        where they go.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Offer these models in Start a chat (preview)</span>
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span>Runtime</span>
          <select
            className="field"
            value={kind}
            onChange={(e) => setKind(e.target.value as LocalRuntime["kind"])}
          >
            <option value="ollama">Ollama</option>
            <option value="openai-compatible">OpenAI-compatible server</option>
            <option value="gateway">Your organisation&apos;s gateway (hosted models)</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>Address on this computer</span>
          <input
            className="field w-64"
            value={url}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
      </div>
      {gateway ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span>It forwards to</span>
            <input
              className="field w-56"
              maxLength={60}
              placeholder="Azure OpenAI"
              value={forwardsTo}
              onChange={(e) => setForwardsTo(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>What that provider keeps</span>
            <select
              className="field"
              value={keeps}
              onChange={(e) => setKeeps(e.target.value as NonNullable<LocalRuntime["keeps"]>)}
            >
              <option value="nothing">Nothing (zero data retention)</option>
              <option value="30-days">Up to 30 days</option>
              <option value="unknown">Not known</option>
            </select>
          </label>
        </div>
      ) : null}
      <label className="grid gap-1 text-sm">
        <span>
          Models you allow, one a line (a name, and for Ollama optionally its sha256 digest)
        </span>
        <textarea
          className="field mono"
          rows={3}
          spellCheck={false}
          value={models}
          onChange={(e) => setModels(e.target.value)}
        />
      </label>
      <div>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Checking…" : "Save and check"}
        </button>
      </div>
      {check ? (
        <p role="status" className="m-0 text-xs">
          {check.ok
            ? `Ready${check.version ? ` (Ollama ${check.version})` : ""}: ${check.models.join(", ")}.${
                check.left.length
                  ? ` Left out: ${check.left.map((l) => `${l.name} (${l.why})`).join("; ")}.`
                  : ""
              }`
            : `Not ready: ${check.reason}`}
        </p>
      ) : null}
    </>
  )
}
