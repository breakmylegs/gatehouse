import { spawn as nodeSpawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { sanitiseEnv } from "@gatehouse/shared"

/**
 * Signing in from inside the app. Gatehouse never handles a credential: it only starts Anthropic's own
 * sign-in (`claude auth login`) in the unmodified Claude Code binary that ships with the SDK. That opens the
 * default browser on Anthropic's page. The result lands in Claude Code's own store, which Gatehouse never reads.
 * Gatehouse then asks the account check again.
 */
export type SignInMethod = "claudeai" | "sso"

export interface SignInStatus {
  state: "idle" | "waiting" | "finished" | "failed"
  message: string
  /** The page the browser was sent to, so you can open it yourself if no browser appeared. */
  url?: string
}

export interface SignInDeps {
  /** Path of the Claude Code binary, or undefined when there is none. */
  binary: () => string | undefined
  env?: () => Record<string, string | undefined>
  spawnFn?: typeof nodeSpawn
  /** Called once when the sign-in process ends, whatever the result. */
  onEnded: () => void | Promise<void>
  timeoutMs?: number
}

const URL_RE = /https:\/\/[^\s"'<>]+/

/** The Claude Code binary that the SDK installed next to us, found without reading anything of the user's. */
export function findClaudeBinary(): string | undefined {
  try {
    const req = createRequire(import.meta.url)
    const pkg = req.resolve(
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
    )
    const exe = path.join(path.dirname(pkg), process.platform === "win32" ? "claude.exe" : "claude")
    return fs.existsSync(exe) ? exe : undefined
  } catch {
    return undefined
  }
}

export class SignInFlow {
  readonly #deps: SignInDeps
  #child: ChildProcess | undefined
  #timer: NodeJS.Timeout | undefined
  #status: SignInStatus = { state: "idle", message: "" }

  constructor(deps: SignInDeps) {
    this.#deps = deps
  }

  status(): SignInStatus {
    return this.#status
  }

  start(method: SignInMethod): SignInStatus {
    if (this.#child) return this.#status
    const binary = this.#deps.binary()
    if (!binary) {
      return (this.#status = {
        state: "failed",
        message:
          "The Claude Code program was not found, so the app cannot start the sign-in. Open a terminal and run: claude auth login",
      })
    }
    const args = ["auth", "login", method === "sso" ? "--sso" : "--claudeai"]
    const child = (this.#deps.spawnFn ?? nodeSpawn)(binary, args, {
      env: this.#deps.env?.() ?? sanitiseEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    this.#child = child
    this.#status = {
      state: "waiting",
      message: "Finish signing in in your browser. This window updates when you are done.",
    }
    // Only the address of the sign-in page is kept from the output. Nothing else is stored or logged.
    const watch = (chunk: Buffer | string): void => {
      if (this.#status.url) return
      const m = URL_RE.exec(String(chunk))
      if (m) this.#status = { ...this.#status, url: m[0] }
    }
    child.stdout?.on("data", watch)
    child.stderr?.on("data", watch)
    this.#timer = setTimeout(
      () => {
        this.#status = { state: "failed", message: "Sign-in timed out after 5 minutes. Try again." }
        child.kill()
      },
      this.#deps.timeoutMs ?? 5 * 60_000,
    )
    this.#timer.unref()
    let ended = false
    const end = (code: number | null, error?: string): void => {
      if (ended) return
      ended = true
      clearTimeout(this.#timer)
      this.#child = undefined
      if (this.#status.state === "waiting") {
        this.#status =
          code === 0
            ? { state: "finished", message: "Signed in. Checking your account." }
            : {
                state: "failed",
                message:
                  error ?? `Sign-in did not finish (exit code ${code ?? "unknown"}). Try again.`,
              }
      }
      void Promise.resolve(this.#deps.onEnded()).catch(() => undefined)
    }
    child.on("error", (e) => end(null, `Could not start the sign-in: ${e.message}`))
    child.on("exit", (code) => end(code))
    return this.#status
  }

  cancel(): SignInStatus {
    if (this.#child) {
      this.#status = { state: "failed", message: "Sign-in cancelled." }
      this.#child.kill()
    }
    return this.#status
  }
}
