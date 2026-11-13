import { execFile } from "node:child_process"

// Mac fork (owner, 13 Nov): a session in a folder with a direnv .envrc starts with what that .envrc sets, as a Terminal
// opened there would, so a folder's own git and gh accounts (GH_CONFIG_DIR, GIT_SSH_COMMAND and the like) work in its
// sessions. Claude's shell commands do not run direnv's hook, so without this they never would. Only an .envrc you
// allowed with `direnv allow` loads (direnv's own check). A folder may never set Claude's credentials or sign-in
// (ANTHROPIC_*, CLAUDE_*: invariant 6) or Codehouse's own settings (GATEHOUSE_*). If direnv is not there, is slow or
// fails, the session starts as it would without it. Values are never logged, only names. sessions.ts calls this.

export type Env = Record<string, string | undefined>
type Exec = (cwd: string, env: Env) => Promise<string>

/** What a folder's .envrc may never set. */
const NEVER = /^(ANTHROPIC_|CLAUDE_|GATEHOUSE_)/i

const direnv: Exec = (cwd, env) =>
  new Promise((resolve, reject) =>
    execFile(
      "direnv",
      ["export", "json"],
      { cwd, env: env as NodeJS.ProcessEnv, timeout: 5_000, maxBuffer: 1 << 20 },
      (e, out, err) =>
        e
          ? reject(Object.assign(e, { said: String(err).trim().split("\n").at(-1) ?? "" }))
          : resolve(String(out)),
    ),
  )

/** The session's environment with its folder's .envrc applied, or `env` as it was. */
export async function withDirenvMac(
  cwd: string,
  env: Env,
  log: (line: string) => void,
  o: { platform?: NodeJS.Platform; exec?: Exec } = {},
): Promise<Env> {
  if ((o.platform ?? process.platform) !== "darwin") return env
  // direnv compares with what it loaded before; a Host started from a shell with one loaded must not pass for it.
  const fresh = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("DIRENV_")))
  let out: string
  try {
    out = await (o.exec ?? direnv)(cwd, fresh)
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { said?: string }
    if (err.code !== "ENOENT") log(`direnv did not load for this session: ${err.said || err.message}`)
    return env
  }
  if (!out.trim()) return env
  let changes: Record<string, unknown>
  try {
    changes = JSON.parse(out) as Record<string, unknown>
  } catch {
    log("direnv did not load for this session: its answer was not JSON")
    return env
  }
  const next: Env = { ...fresh }
  const loaded: string[] = []
  const refused: string[] = []
  for (const [k, v] of Object.entries(changes)) {
    if (NEVER.test(k)) refused.push(k)
    else if (v === null) delete next[k]
    else if (typeof v === "string") {
      next[k] = v
      if (!k.startsWith("DIRENV_")) loaded.push(k)
    }
  }
  if (loaded.length) log(`direnv: this session has ${loaded.join(", ")} from its folder's .envrc`)
  if (refused.length) log(`direnv: left out ${refused.join(", ")}; Codehouse never takes these from a folder`)
  return next
}
