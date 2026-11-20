import { api } from "./api"

/** T-136: which way the microphone recognises speech. Windows voice typing unless you choose the server. */
export type VoiceMode = "windows" | "server"
const MODE = "gatehouse.voiceMode"

export function voiceMode(): VoiceMode {
  try {
    return localStorage.getItem(MODE) === "server" ? "server" : "windows"
  } catch {
    return "windows"
  }
}

export function setVoiceMode(m: VoiceMode): void {
  try {
    if (m === "server") localStorage.setItem(MODE, "server")
    else localStorage.removeItem(MODE)
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
  window.dispatchEvent(new Event("codeh:voice"))
}

/** Puts text where the caret is in a box React controls, as typing would, so its state follows. */
export function insertAtCaret(box: HTMLTextAreaElement, text: string): void {
  const start = box.selectionStart ?? box.value.length
  const end = box.selectionEnd ?? start
  const before = box.value.slice(0, start)
  const spaced = before && !/\s$/.test(before) ? ` ${text}` : text
  const next = before + spaced + box.value.slice(end)
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  setter?.call(box, next)
  box.selectionStart = box.selectionEnd = start + spaced.length
  box.dispatchEvent(new Event("input", { bubbles: true }))
}

const base64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** A recording sent to the speech server through the Host: the words, or a reason in words. */
export async function transcribe(blob: Blob): Promise<{ text: string } | { error: string }> {
  const r = await api<{ text: string }>("POST", "/api/voice/transcribe", { audio: await base64(blob), type: blob.type || "audio/webm" })
  return r.ok && typeof r.data?.text === "string" ? { text: r.data.text } : { error: r.error ?? "No words came back." }
}

/** Records from the microphone until stop() is called; then the recording. */
export async function startRecording(): Promise<{ stop: () => Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const rec = new MediaRecorder(stream)
  const parts: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data)
  rec.start()
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(new Blob(parts, { type: rec.mimeType || "audio/webm" }))
        }
        rec.stop()
      }),
  }
}
