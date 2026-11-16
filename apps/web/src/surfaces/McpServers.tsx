import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  buildServer,
  changeServer,
  createServer,
  listServers,
  removeServer,
  runServer,
  type BuiltServerView,
} from "../lib/mcpServers"
import { useStore } from "../store"

const STATE: Record<BuiltServerView["state"], { word: string; className: string }> = {
  running: { word: "Running", className: "text-ok" },
  starting: { word: "Starting", className: "text-mut" },
  stopped: { word: "Stopped", className: "text-mut" },
  failed: { word: "Did not start", className: "text-sev" },
}

const CPU = [0, 10, 20, 50, 75]
const MEMORY = [256, 512, 1024, 2048, 0]

/**
 * O39, the MCP builder: servers you build with Claude, run by Codehouse inside the limits you set, and given to a code
 * session with /mcp <name>. Building one is a code session in its folder, with the other servers that are running
 * given to it, so it can call them while it works.
 */
export function McpServers() {
  const [servers, setServers] = useState<BuiltServerView[]>()
  const [error, setError] = useState<string>()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState<string>()
  const selectSession = useStore((s) => s.selectSession)

  const load = useCallback(async () => {
    const r = await listServers()
    if (r.ok) {
      setServers(r.data?.servers ?? [])
      setError(undefined)
    } else setError(r.error ?? "The servers could not be listed.")
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 4000)
    return () => clearInterval(t)
  }, [load])

  async function act(key: string, f: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    setBusy(key)
    const r = await f()
    setBusy(undefined)
    if (!r.ok) toast(r.error ?? "That did not work.", { id: "mcp" })
    else if (done) toast(done, { id: "mcp" })
    await load()
  }

  async function build(n: string) {
    setBusy(`build-${n}`)
    const r = await buildServer(n)
    setBusy(undefined)
    if (!r.ok || !r.data) {
      toast(r.error ?? "The session could not start.", { id: "mcp" })
      return
    }
    selectSession(r.data.sessionId)
  }

  return (
    <section aria-labelledby="mcp-title" className="mx-auto grid max-w-3xl gap-4 p-6">
      <div>
        <h1 id="mcp-title" className="m-0">
          MCP servers
        </h1>
        <p className="m-0 mt-1 text-mut">
          Servers you build with Claude. Codehouse runs them while it is open, inside the limits you set here, and a code
          session uses one when you type /mcp and its name. Each call a session makes to one is checked like any other.
        </p>
      </div>

      <form
        className="panel flex flex-wrap items-end gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim()
          if (!n) return
          void act("create", () => createServer(n), `Made ${n}. Build it in a session, then start it.`).then(() => setName(""))
        }}
      >
        <label className="grid gap-1">
          <span className="text-sm font-semibold">A new server</span>
          <input
            className="field mono"
            value={name}
            placeholder="weather-lookup"
            aria-describedby="mcp-name-help"
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy === "create"}>
          Make it
        </button>
        <span id="mcp-name-help" className="w-full text-xs text-mut">
          Lower case letters, digits and dashes. It starts with a small example tool, so it runs straight away.
        </span>
      </form>

      <p role="status" className="m-0">
        {error ? error : !servers ? "Loading." : servers.length === 0 ? "No servers yet. Make one above." : ""}
      </p>

      {servers?.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {servers.map((s) => (
            <ServerRow key={s.name} s={s} busy={busy} act={act} build={build} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ServerRow({
  s,
  busy,
  act,
  build,
}: {
  s: BuiltServerView
  busy: string | undefined
  act: (key: string, f: () => Promise<{ ok: boolean; error?: string }>, done?: string) => Promise<void>
  build: (n: string) => Promise<void>
}) {
  const st = STATE[s.state]
  const running = s.state === "running"
  const [removing, setRemoving] = useState(false)
  return (
    <li className="panel grid gap-2 p-3" aria-label={`MCP server ${s.name}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <strong className="mono">{s.name}</strong>
        <span className={st.className}>{st.word}</span>
        {running ? (
          <span className="text-sm text-mut">
            {s.tools.length === 1 ? "1 tool" : `${s.tools.length} tools`}
            {s.tools.length ? `: ${s.tools.map((t) => t.name).join(", ")}` : ""}
            {s.limited ? "" : ". No limits on this computer"}
          </span>
        ) : null}
      </div>
      {s.state === "failed" && s.error ? (
        <pre className="cmd m-0 max-h-24 overflow-auto whitespace-pre-wrap text-xs">{s.error}</pre>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={busy === `build-${s.name}`} onClick={() => void build(s.name)}>
          Build it in a session
        </button>
        {running ? (
          <>
            <button type="button" className="btn" disabled={!!busy} onClick={() => void act(s.name, () => runServer(s.name, "restart"), `Restarted ${s.name}.`)}>
              Restart
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => void act(s.name, () => runServer(s.name, "stop"))}>
              Stop
            </button>
          </>
        ) : (
          <button type="button" className="btn" disabled={!!busy || s.state === "starting"} onClick={() => void act(s.name, () => runServer(s.name, "start"))}>
            Start
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.autostart}
            onChange={(e) => void act(s.name, () => changeServer(s.name, { autostart: e.target.checked }))}
          />
          Start with Codehouse
        </label>
        <label className="flex items-center gap-2">
          Processor
          <select className="field" value={s.cpu} onChange={(e) => void act(s.name, () => changeServer(s.name, { cpu: Number(e.target.value) }), "Saved. Restart it to apply.")}>
            {[...new Set([...CPU, s.cpu])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "No limit" : `${n}%`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Memory
          <select className="field" value={s.memoryMb} onChange={(e) => void act(s.name, () => changeServer(s.name, { memoryMb: Number(e.target.value) }), "Saved. Restart it to apply.")}>
            {[...new Set([...MEMORY, s.memoryMb])].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "No limit" : n >= 1024 ? `${n / 1024} GB` : `${n} MB`}
              </option>
            ))}
          </select>
        </label>
        {removing ? (
          <span className="flex items-center gap-2">
            Take it off the list? Its folder is kept.
            <button type="button" className="btn btn-strong" onClick={() => void act(s.name, () => removeServer(s.name), `Took ${s.name} off the list.`)}>
              Yes
            </button>
            <button type="button" className="btn" onClick={() => setRemoving(false)}>
              No
            </button>
          </span>
        ) : (
          <button type="button" className="btn ml-auto" onClick={() => setRemoving(true)}>
            Remove
          </button>
        )}
      </div>
    </li>
  )
}
