import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { sanitiseEnv } from "@gatehouse/shared"

/**
 * The phone Relay run by JCVC itself, only while JCVC is running. It listens on this computer (127.0.0.1); your
 * phone reaches it through the https address you give (a tunnel such as Tailscale Funnel or Cloudflare Tunnel points
 * that address at the port). JCVC connects to it over loopback and enrols itself with the one-time token the Relay
 * writes, so you never copy a token by hand. The Relay still only ever sees ciphertext (invariant 8).
 */
export type LocalRelayState = "off" | "starting" | "running" | "failed"

export interface LocalRelayStatus {
  state: LocalRelayState
  port: number
  publicUrl?: string
  message?: string
}

export interface LocalRelayDeps {
  /** How to start the Relay: the program and its arguments, without the per-run options. */
  command: string
  args: string[]
  cwd: string
  dataDir: string
  log: (line: string) => void
  /** Connects the Host's phone channel to the Relay with its one-time enrolment token. */
  enrol: (url: string, token: string) => Promise<void>
  /** True when the phone channel already has a Relay link, so enrolling again is not needed. */
  linked: () => boolean
  spawnFn?: typeof spawn
  readyTimeoutMs?: number
}

export class LocalRelay {
  readonly #d: LocalRelayDeps
  #child: ChildProcess | undefined
  #status: LocalRelayStatus = { state: "off", port: 8087 }
  #stopping = false

  constructor(deps: LocalRelayDeps) {
    this.#d = deps
  }

  status(): LocalRelayStatus {
    return this.#status
  }

  /** Starts the Relay for this https address and port, and links JCVC to it. Resolves once it is running. */
  async start(publicUrl: string, port: number): Promise<LocalRelayStatus> {
    await this.stop()
    let u: URL
    try {
      u = new URL(publicUrl)
    } catch {
      return this.#fail(port, publicUrl, "That is not a web address.")
    }
    if (u.protocol !== "https:")
      return this.#fail(
        port,
        publicUrl,
        "Your phone needs an https address, for example https://my-laptop.tail1234.ts.net",
      )
    this.#stopping = false
    this.#status = { state: "starting", port, publicUrl: u.origin }
    const child = (this.#d.spawnFn ?? spawn)(
      this.#d.command,
      [
        ...this.#d.args,
        "--public-url",
        u.origin,
        "--port",
        String(port),
        "--data-dir",
        this.#d.dataDir,
      ],
      {
        cwd: this.#d.cwd,
        env: { ...sanitiseEnv(process.env), RELAY_HOST: "127.0.0.1" },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    )
    this.#child = child
    const ready = await new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(
        () => resolve("The Relay did not start within 60 seconds."),
        this.#d.readyTimeoutMs ?? 60_000,
      )
      const onLine = (chunk: Buffer | string) => {
        const text = String(chunk)
        for (const line of text.split(/\r?\n/))
          if (line.trim()) this.#d.log(`relay: ${line.trim()}`)
        if (/listening on/i.test(text)) {
          clearTimeout(timer)
          resolve(undefined)
        }
      }
      child.stdout?.on("data", onLine)
      child.stderr?.on("data", onLine)
      child.once("exit", (code) => {
        clearTimeout(timer)
        resolve(
          `The Relay stopped (exit code ${code ?? "unknown"}). Its messages are in the Host log.`,
        )
      })
      child.once("error", (e) => {
        clearTimeout(timer)
        resolve(`The Relay could not start: ${e.message}`)
      })
    })
    if (ready) {
      await this.stop()
      return this.#fail(port, u.origin, ready)
    }
    child.once("exit", () => {
      if (this.#stopping) return
      this.#child = undefined
      this.#status = {
        ...this.#status,
        state: "failed",
        message: "The Relay stopped. Start it again from Devices.",
      }
    })
    if (!this.#d.linked()) {
      const tokenFile = path.join(this.#d.dataDir, "enrol-token.txt")
      try {
        const token = fs.readFileSync(tokenFile, "utf8").trim()
        await this.#d.enrol(`http://127.0.0.1:${port}`, token)
      } catch (e) {
        await this.stop()
        return this.#fail(
          port,
          u.origin,
          `JCVC could not connect to its Relay: ${(e as Error).message}`,
        )
      }
    }
    this.#status = { state: "running", port, publicUrl: u.origin }
    return this.#status
  }

  async stop(): Promise<void> {
    this.#stopping = true
    const child = this.#child
    this.#child = undefined
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve())
        child.stdin?.end()
        child.kill()
        setTimeout(() => resolve(), 5000).unref()
      })
    }
    if (this.#status.state !== "failed") this.#status = { ...this.#status, state: "off" }
  }

  #fail(port: number, publicUrl: string, message: string): LocalRelayStatus {
    this.#status = { state: "failed", port, publicUrl, message }
    return this.#status
  }
}
