import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { EmptyState } from "../components/EmptyState"

interface Contents {
  commands: number
  agents: number
  skills: number
  hooks: boolean
  mcpServers: boolean
  lspServers: boolean
  dependencies: number
}
interface Plugin {
  id: string
  name: string
  marketplace: string
  description?: string
  version?: string
  category?: string
  contents?: Contents
  refusal?: string
  installed?: { version?: string; enabled: boolean }
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`

/** What a plugin holds, in words, the parts Codehouse refuses first. */
export function holds(c: Contents | undefined): string[] {
  if (!c) return ["Not readable before installing"]
  return [
    ...(c.hooks ? ["Hooks"] : []),
    ...(c.mcpServers ? ["MCP servers"] : []),
    ...(c.lspServers ? ["Language servers"] : []),
    ...(c.dependencies ? [n(c.dependencies, "other plugin", "other plugins")] : []),
    ...(c.skills ? [n(c.skills, "skill", "skills")] : []),
    ...(c.commands ? [n(c.commands, "command", "commands")] : []),
    ...(c.agents ? [n(c.agents, "agent", "agents")] : []),
  ]
}

/**
 * The marketplace (W1-19): the plugins of the marketplaces Claude Code knows, what each holds, and Install for one Codehouse
 * has read and allows. Installed plugins are added to your coding sessions (chats load none).
 */
export function Marketplace() {
  const [data, setData] = useState<{ marketplaces: string[]; plugins: Plugin[] }>()
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState("")
  const [asking, setAsking] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const load = useCallback(async () => {
    const r = await api<{ marketplaces: string[]; plugins: Plugin[] }>("GET", "/api/marketplace")
    if (!r.ok || !r.data) return setError(r.error ?? "The marketplaces could not be read")
    setError(undefined)
    setData(r.data)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.plugins ?? [])
      .filter(
        (p) =>
          !q || `${p.name} ${p.description ?? ""} ${p.category ?? ""}`.toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.installed)) - Number(Boolean(a.installed)) ||
          a.name.localeCompare(b.name),
      )
  }, [data, query])

  async function act(p: Plugin, action: "install" | "uninstall") {
    setAsking(undefined)
    setBusy(p.id)
    const r = await api<{ message: string }>("POST", `/api/marketplace/${action}`, { id: p.id })
    setBusy(undefined)
    if (!r.ok) toast.error(r.error ?? "That did not work", { id: "marketplace" })
    else
      toast(
        action === "install"
          ? `Installed ${p.name}. Coding sessions you start from now on have it.`
          : `Removed ${p.name}.`,
        { id: "marketplace" },
      )
    await load()
  }

  return (
    <div className="grid max-w-[980px] gap-5 p-6">
      <div>
        <h1 className="m-0">Marketplace</h1>
        <p className="m-0 mt-1 max-w-[70ch] text-mut">
          Plugins from the marketplaces Claude Code knows on this computer. A plugin is someone
          else&apos;s code, so Codehouse installs only one it can read first, and never one with
          hooks or servers that run outside the session. Installs and removals go in the audit log.
        </p>
      </div>
      <label className="grid max-w-md gap-1">
        <span className="sr-only">Search plugins</span>
        <input
          className="field"
          type="search"
          placeholder="Search plugins"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className="m-0 text-bad">
          {error}
        </p>
      ) : !data ? (
        <p className="m-0 text-mut">Reading the marketplaces…</p>
      ) : data.plugins.length === 0 ? (
        <EmptyState picture="empty-marketplace">
          <p className="m-0 text-mut">
            No marketplace on this computer lists any plugins. Claude Code adds its official
            marketplace the first time it starts.
          </p>
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Plugins">
          {shown.map((p) => (
            <li key={p.id} className="panel grid gap-2 p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <strong>{p.name}</strong>
                {p.version ? <span className="mono text-[12px] text-mut">{p.version}</span> : null}
                <span className="text-[12px] text-mut">from {p.marketplace}</span>
                {p.installed ? (
                  <span className="ml-auto text-[12.5px] font-medium text-ok">Installed</span>
                ) : null}
              </div>
              {p.description ? <p className="m-0 text-[13.5px]">{p.description}</p> : null}
              <ul
                className="m-0 flex list-none flex-wrap gap-1.5 p-0"
                aria-label={`What ${p.name} holds`}
              >
                {holds(p.contents).map((h) => (
                  <li key={h} className="rounded border border-line bg-s2 px-2 py-0.5 text-[12px]">
                    {h}
                  </li>
                ))}
              </ul>
              {p.installed ? (
                <span>
                  <button
                    type="button"
                    className="btn !min-h-7"
                    disabled={busy !== undefined}
                    onClick={() => void act(p, "uninstall")}
                  >
                    {busy === p.id ? "Removing…" : "Remove"}
                  </button>
                </span>
              ) : p.refusal ? (
                <p className="m-0 text-[12.5px] text-mut">
                  Codehouse does not install it. {p.refusal}
                </p>
              ) : asking === p.id ? (
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label={`Install ${p.name}?`}
                >
                  <span className="text-[13px]">
                    Install {p.name}? Every coding session you start from now on has what it holds.
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary !min-h-7"
                    onClick={() => void act(p, "install")}
                  >
                    Install
                  </button>
                  <button
                    type="button"
                    className="btn !min-h-7"
                    onClick={() => setAsking(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <span>
                  <button
                    type="button"
                    className="btn !min-h-7"
                    disabled={busy !== undefined}
                    onClick={() => setAsking(p.id)}
                  >
                    {busy === p.id ? "Installing…" : "Install…"}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
