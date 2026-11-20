// T-136: speech to text through a Whisper-compatible server on this computer only, off until named; your words to
// expect go with it, fillers come out, nothing is kept; and the window lets only its own page use the microphone.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { checkVoiceServer, cleanTranscript, registerVoiceRoutes, VoiceSettings } from "../src/voice.js"

const repo = path.resolve(import.meta.dirname, "../../..")

describe("the speech server (T-136)", () => {
  it("is only one on this computer, with no sign-in in its address", () => {
    expect(checkVoiceServer({ url: "http://127.0.0.1:8080/", words: ["Codehouse", " Gatehouse ", ""] })).toEqual({ url: "http://127.0.0.1:8080", words: ["Codehouse", "Gatehouse"] })
    expect(checkVoiceServer({ url: "http://localhost:9000/whisper" })).toEqual({ url: "http://localhost:9000/whisper" })
    expect(checkVoiceServer({ url: "https://api.openai.com" })).toMatch(/on this computer/)
    expect(checkVoiceServer({ url: "http://127.0.0.1.example.com" })).toMatch(/on this computer/)
    expect(checkVoiceServer({ url: "http://user:pw@127.0.0.1:8080" })).toMatch(/user name or password/)
    expect(checkVoiceServer({ url: "file:///c:/x" })).toMatch(/http/)
    expect(checkVoiceServer({})).toMatch(/address/)
  })

  it("takes the fillers out of what comes back", () => {
    expect(cleanTranscript("Um, so, uh, fix the login bug, er, today. Hmm.")).toBe("so, fix the login bug, today.")
    expect(cleanTranscript("Summary of the umbrella module")).toBe("Summary of the umbrella module")
  })

  it("passes the recording to the server with the words to expect, and keeps nothing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-voice-"))
    const sent: Array<{ url: string; fields: Record<string, unknown> }> = []
    const fake = (async (url: string, init: RequestInit) => {
      const form = init.body as FormData
      sent.push({ url, fields: Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `blob:${(v as Blob).size}`])) })
      return new Response(JSON.stringify({ text: "Um, run the tests." }), { status: 200 })
    }) as unknown as typeof fetch
    const recorded: string[] = []
    const app = Fastify()
    registerVoiceRoutes(app, { settings: new VoiceSettings(dir), record: async (e) => (recorded.push(e), true), fetch: fake })
    try {
      const audio = Buffer.from("fake audio").toString("base64")
      expect((await app.inject({ method: "POST", url: "/api/voice/transcribe", payload: { audio } })).statusCode).toBe(409)
      expect((await app.inject({ method: "PUT", url: "/api/voice-server", payload: { server: { url: "https://speech.example.com" } } })).statusCode).toBe(422)
      expect((await app.inject({ method: "PUT", url: "/api/voice-server", payload: { server: { url: "http://127.0.0.1:8080", words: ["Codehouse"] } } })).statusCode).toBe(200)
      const r = await app.inject({ method: "POST", url: "/api/voice/transcribe", payload: { audio, type: "audio/webm;codecs=opus" } })
      expect(r.json()).toEqual({ text: "run the tests." })
      expect(sent).toEqual([{ url: "http://127.0.0.1:8080/v1/audio/transcriptions", fields: { file: "blob:10", model: "whisper-1", response_format: "json", prompt: "Codehouse" } }])
      expect(fs.readdirSync(dir)).toEqual(["voice-server.json"])
      expect(recorded).toEqual(["voice_server_changed"])
    } finally {
      await app.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("lets only Codehouse's own page use the microphone in the window", () => {
    const app = fs.readFileSync(path.join(repo, "packaging", "CodehouseApp.cs"), "utf8")
    expect(app).toContain("(e.PermissionKind == CoreWebView2PermissionKind.Microphone && ownPage)")
    expect(app).toMatch(/bool ownPage = url != null && e\.Uri != null && e\.Uri\.StartsWith\(new Uri\(url\)\.GetLeftPart\(UriPartial\.Authority\) \+ "\/"/)
    // The quick prompt's window still allows nothing.
    const overlay = fs.readFileSync(path.join(repo, "packaging", "Overlay.cs"), "utf8")
    expect(overlay).toContain("e.State = CoreWebView2PermissionState.Deny;")
  })
})
