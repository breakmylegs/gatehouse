import { execFile } from "node:child_process"
import os from "node:os"

/**
 * B19: what this computer can run, for choosing a model on it. Memory from the system; the graphics card from Windows
 * (its name and memory, which Windows reports up to 4 GB at most, so "4 GB or more" is said as at least 4). Read once
 * and kept for the Host's life. Nothing here leaves the computer.
 */
export interface Hardware {
  memoryGb: number
  gpu?: { name: string; memoryGb: number; atLeast: boolean }
}

export type ProfileSize = "small" | "medium" | "large"

export interface Profile extends Hardware {
  size: ProfileSize
  advice: string
}

const GB = 1024 ** 3

const SCRIPT =
  "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json -Compress"

/** The graphics cards Windows knows, or none where that cannot be read. */
export function readGpus(): Promise<Array<{ name: string; bytes: number }>> {
  if (process.platform !== "win32") return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
      { windowsHide: true, timeout: 20_000 },
      (e, out) => {
        if (e) return resolve([])
        try {
          const v = JSON.parse(String(out)) as unknown
          const list = (Array.isArray(v) ? v : [v]) as Array<{
            Name?: unknown
            AdapterRAM?: unknown
          }>
          resolve(
            list
              .filter((g) => typeof g.Name === "string")
              .map((g) => ({
                name: String(g.Name).slice(0, 120),
                bytes: Number(g.AdapterRAM) || 0,
              })),
          )
        } catch {
          resolve([])
        }
      },
    )
  })
}

/** The size of model this computer runs comfortably, and why, in plain words. */
export function profileOf(h: Hardware): Profile {
  const vram = h.gpu?.memoryGb ?? 0
  const size: ProfileSize =
    h.memoryGb >= 64 || (h.memoryGb >= 32 && vram >= 8)
      ? "large"
      : h.memoryGb >= 16
        ? "medium"
        : "small"
  const advice =
    size === "large"
      ? "This computer can run large models, up to about 14 billion parameters (such as qwen2.5:14b), and smaller ones quickly."
      : size === "medium"
        ? "This computer suits medium models of about 7 to 8 billion parameters (such as llama3.1:8b or qwen2.5:7b). Larger ones will be slow."
        : "This computer suits small models of up to about 3 billion parameters (such as llama3.2:3b or qwen2.5:3b). Larger ones may not fit in its memory."
  return { ...h, size, advice }
}

let cached: Promise<Profile> | undefined

/** This computer's profile, read once. */
export function machineProfile(
  gpus: () => Promise<Array<{ name: string; bytes: number }>> = readGpus,
): Promise<Profile> {
  cached ??= gpus().then((list) => {
    // The card with the most memory is the one a runtime would use.
    const best = [...list].sort((a, b) => b.bytes - a.bytes)[0]
    const memoryGb = Math.round(os.totalmem() / GB)
    return profileOf({
      memoryGb,
      ...(best
        ? {
            gpu: {
              name: best.name,
              memoryGb: Math.round(best.bytes / GB),
              atLeast: best.bytes >= 4 * GB - 1,
            },
          }
        : {}),
    })
  })
  return cached
}

/** Only for tests: forget what was read. */
export const forgetProfile = (): void => {
  cached = undefined
}
