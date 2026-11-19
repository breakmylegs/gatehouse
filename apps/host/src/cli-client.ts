import fs from "node:fs"
import path from "node:path"
import { gatehouseDataDir } from "@gatehouse/shared/node"
import { CLI_PORT_FILE, CLI_TOKEN_FILE, type CliSession } from "./cli-access.js"
import { sealerFor, type Protector } from "./relay/protector.js"

/**
 * T-124: the `codehouse` command, for scripts on this computer. It reads the port and the sealed token Codehouse wrote
 * when you switched the command line on (Settings), opens the token for you, and talks to the Host on 127.0.0.1 only.
 *
 *   codehouse list
 *   codehouse start <folder> [prompt...]
 *   codehouse send <session id> <prompt...> [--wait]
 *   codehouse show <session id>
 */
export const USAGE = `codehouse list
codehouse start <folder> [prompt...]
codehouse send <session id> <prompt...> [--wait]
codehouse show <session id>`

export type CliCommand =
  | { kind: "list" }
  | { kind: "start"; cwd: string; prompt: string }
  | { kind: "send"; id: string; prompt: string; wait: boolean }
  | { kind: "show"; id: string }

/** The command from its arguments, or a reason in words. */
export function parseCli(argv: string[]): CliCommand | string {
  const wait = argv.includes("--wait")
  const a = argv.filter((x) => x !== "--wait")
  const [verb, first, ...rest] = a
  // t3code's names too: "thread start".
  if (verb === "thread" && first === "start") return parseCli(["start", ...rest, ...(wait ? ["--wait"] : [])])
  if (verb === "list" && !first) return { kind: "list" }
  if (verb === "start" && first) return { kind: "start", cwd: first, prompt: rest.join(" ") }
  if (verb === "send" && first && rest.length) return { kind: "send", id: first, prompt: rest.join(" "), wait }
  if (verb === "show" && first && !rest.length) return { kind: "show", id: first }
  return `Usage:\n${USAGE}`
}

export function requestFor(c: CliCommand): { method: "GET" | "POST"; path: string; body?: Record<string, unknown> } {
  switch (c.kind) {
    case "list":
      return { method: "GET", path: "/cli/sessions" }
    case "start":
      return { method: "POST", path: "/cli/sessions", body: { cwd: c.cwd, ...(c.prompt ? { prompt: c.prompt } : {}) } }
    case "send":
      return { method: "POST", path: `/cli/sessions/${encodeURIComponent(c.id)}/send`, body: { prompt: c.prompt, wait: c.wait } }
    case "show":
      return { method: "GET", path: `/cli/sessions/${encodeURIComponent(c.id)}` }
  }
}

/** What to print for an answer. */
export function printable(c: CliCommand, data: Record<string, unknown>): string {
  if (c.kind === "list")
    return ((data.sessions as CliSession[] | undefined) ?? []).map((s) => `${s.id}  ${s.state.padEnd(8)}  ${s.title ?? ""}  ${s.cwd}`).join("\n") || "No sessions are open."
  if (c.kind === "start") return String(data.id ?? "")
  const s = data.session as CliSession | undefined
  const answer = typeof data.lastAnswer === "string" ? data.lastAnswer : ""
  if (c.kind === "send" && !c.wait) return "sent"
  return [s ? `${s.id}  ${s.state}  ${s.title ?? ""}` : "", answer].filter(Boolean).join("\n\n")
}

export async function runCli(argv: string[], o: { dir?: string; protector?: Protector; fetch?: typeof fetch } = {}): Promise<{ code: number; out: string }> {
  const c = parseCli(argv)
  if (typeof c === "string") return { code: 2, out: c }
  const dir = o.dir ?? gatehouseDataDir(process.env)
  let port: number
  let token: string
  try {
    port = (JSON.parse(fs.readFileSync(path.join(dir, CLI_PORT_FILE), "utf8")) as { port: number }).port
    const sealed = Buffer.from(fs.readFileSync(path.join(dir, CLI_TOKEN_FILE), "utf8").trim(), "base64")
    const protector = o.protector ?? sealerFor({ helper: () => undefined })
    token = new TextDecoder().decode(await protector.unprotect(new Uint8Array(sealed)))
  } catch {
    return { code: 3, out: "The command line is off. Switch it on in Codehouse: Settings, Command line." }
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return { code: 3, out: "Codehouse's port could not be read." }
  const req = requestFor(c)
  try {
    const res = await (o.fetch ?? fetch)(`http://127.0.0.1:${port}${req.path}`, {
      method: req.method,
      headers: { authorization: `Bearer ${token}`, ...(req.body ? { "content-type": "application/json" } : {}) },
      ...(req.body ? { body: JSON.stringify(req.body) } : {}),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { code: 1, out: typeof data.error === "string" ? data.error : `Codehouse answered ${res.status}.` }
    return { code: 0, out: printable(c, data) }
  } catch {
    return { code: 3, out: "Codehouse is not running." }
  }
}

if (process.argv[1] && /cli-client\.(ts|js|mjs)$/.test(process.argv[1])) {
  void runCli(process.argv.slice(2)).then((r) => {
    ;(r.code === 0 ? process.stdout : process.stderr).write(r.out + "\n")
    process.exitCode = r.code
  })
}
