import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../../..")

describe("scripts/start.ps1", () => {
  it("starts the Host, shows the one-time address, proves the token is needed, and stops everything", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-start-"))
    const env = {
      ...process.env,
      GATEHOUSE_DATA_DIR: dir,
      GATEHOUSE_AUDIT_DIR: path.join(dir, "audit"),
      GATEHOUSE_CONFIG: path.join(dir, "config.json"),
      GATEHOUSE_STATE: path.join(dir, "state.json"),
      GATEHOUSE_HOST_PORT: "0",
    }
    const child = spawn(
      "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        path.join(ROOT, "scripts", "start.ps1"),
        "-Check",
        "-NoBrowser",
        "-TimeoutSeconds",
        "150",
      ],
      {
        env,
        cwd: ROOT,
        // No input: a child that waits on its parent's stdin would hang a test run.
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    )
    let out = ""
    child.stdout.on("data", (d: Buffer) => (out += d))
    child.stderr.on("data", (d: Buffer) => (out += d))
    // Wait for the script to exit, not for its pipes to close: on this machine a pipe handle outlives the script.
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve))
    await new Promise((r) => setTimeout(r, 500))
    child.stdout.destroy()
    child.stderr.destroy()
    expect(code, out).toBe(0)
    expect(out).toMatch(/Open: http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]{20,}/)
    expect(out).toContain("Check passed")
    fs.rmSync(dir, { recursive: true, force: true })
  }, 240_000)
})
