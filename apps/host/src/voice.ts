import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { writeFileAtomic } from "@gatehouse/shared/node"

/**
 * T-136 (G9): speech to text through a Whisper-compatible server on this computer (whisper.cpp's server,
 * faster-whisper-server and the like, at `/v1/audio/transcriptions`). Off until you name the server in Settings, and
 * only one on 127.0.0.1, localhost or ::1 (invariant 6, ADR 0010: no cloud service, no key). The window records a clip
 * when you press the microphone and the Host passes it on; nothing is kept. Your dictionary goes with it as the
 * prompt (the words the model should expect), and filler words are taken out of what comes back.
 */
export interface VoiceServer {
  url: string
  model?: string
  /** Words to expect: names, terms of the project. */
  words?: string[]
}

export const VOICE_FILE = "voice-server.json"
export const MAX_AUDIO = 10 * 1024 * 1024
const MAX_WORDS = 200
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

/** The server as given, checked: on this computer only. A reason in words otherwise. */
export function checkVoiceServer(v: unknown): VoiceServer | string {
  const o = (v ?? {}) as Partial<VoiceServer>
  let u: URL
  try {
    u = new URL(String(o.url ?? ""))
  } catch {
    return "Give the speech server's address, such as http://127.0.0.1:8080."
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "The speech server's address starts http:// or https://."
  if (!LOCAL.has(u.hostname.toLowerCase())) return "The speech server must be on this computer (127.0.0.1 or localhost)."
  if (u.username || u.password) return "The address cannot carry a user name or password."
  const words = Array.isArray(o.words) ? o.words.filter((w): w is string => typeof w === "string").map((w) => w.trim()).filter((w) => w && w.length <= 60).slice(0, MAX_WORDS) : []
  const model = typeof o.model === "string" && /^[\w.:/-]{1,80}$/.test(o.model) ? o.model : undefined
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, "")}`, ...(model ? { model } : {}), ...(words.length ? { words } : {}) }
}

const FILLERS = /(^|[\s,.;!?])(?:um+|uh+|erm+|er|ah+|hmm+|mm+)(?=[\s,.;!?]|$)[,]?/gi

/** What came back, with filler words taken out and the spaces tidied. */
export function cleanTranscript(text: string): string {
  let t = text
  for (let i = 0; i < 3; i++) t = t.replace(FILLERS, "$1")
  return t
    .replace(/\s+([,.;!?])/g, "$1")
    // What a filler left: "today. ." or "bug, ." becomes one mark.
    .replace(/[,;]+([.!?])/g, "$1")
    .replace(/([.!?])[.,;]+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,]+/, "")
    .trim()
}

export class VoiceSettings {
  constructor(private readonly dir: string) {}

  read(): VoiceServer | undefined {
    try {
      const v = checkVoiceServer(JSON.parse(fs.readFileSync(path.join(this.dir, VOICE_FILE), "utf8")))
      return typeof v === "string" ? undefined : v
    } catch {
      return undefined
    }
  }

  async save(v: VoiceServer | undefined): Promise<void> {
    const file = path.join(this.dir, VOICE_FILE)
    if (!v) return fs.rmSync(file, { force: true })
    fs.mkdirSync(this.dir, { recursive: true })
    await writeFileAtomic(file, JSON.stringify(v, null, 2) + "\n")
  }
}

export interface VoiceDeps {
  settings: VoiceSettings
  record: (event: string, input: Record<string, unknown>) => Promise<boolean>
  fetch?: typeof fetch
}

export function registerVoiceRoutes(app: FastifyInstance, d: VoiceDeps): void {
  app.get("/api/voice-server", async () => ({ server: d.settings.read() ?? null }))
  app.put("/api/voice-server", async (req, reply) => {
    const b = req.body as { server?: unknown } | undefined
    if (b?.server === null) {
      await d.settings.save(undefined)
      await d.record("voice_server_changed", { on: false })
      return { server: null }
    }
    const v = checkVoiceServer(b?.server)
    if (typeof v === "string") return reply.code(422).send({ error: v })
    await d.settings.save(v)
    await d.record("voice_server_changed", { on: true, words: v.words?.length ?? 0 })
    return { server: v }
  })
  app.post("/api/voice/transcribe", { bodyLimit: Math.ceil(MAX_AUDIO * 1.4) }, async (req, reply) => {
    const server = d.settings.read()
    if (!server) return reply.code(409).send({ error: "No speech server is set. Name one in Settings, Voice." })
    const b = (req.body ?? {}) as { audio?: unknown; type?: unknown }
    const type = typeof b.type === "string" && /^audio\/[\w.+-]+(;\s*codecs=[\w.+-]+)?$/.test(b.type) ? b.type : "audio/webm"
    const bytes = typeof b.audio === "string" ? Buffer.from(b.audio, "base64") : Buffer.alloc(0)
    if (!bytes.length || bytes.length > MAX_AUDIO) return reply.code(400).send({ error: "Send a recording of up to 10 MB." })
    const form = new FormData()
    form.append("file", new Blob([bytes], { type }), type.includes("wav") ? "speech.wav" : "speech.webm")
    form.append("model", server.model ?? "whisper-1")
    form.append("response_format", "json")
    if (server.words?.length) form.append("prompt", server.words.join(", "))
    try {
      const res = await (d.fetch ?? fetch)(`${server.url}/v1/audio/transcriptions`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) })
      const data = (await res.json().catch(() => ({}))) as { text?: unknown }
      if (!res.ok || typeof data.text !== "string") return reply.code(502).send({ error: `The speech server answered ${res.status} without words.` })
      return { text: cleanTranscript(data.text) }
    } catch {
      return reply.code(502).send({ error: "The speech server did not answer. Is it running?" })
    }
  })
}
