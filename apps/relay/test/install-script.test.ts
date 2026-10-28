import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.resolve(here, "../../../deploy/relay/install.sh")
const bin = fs.mkdtempSync(path.join(os.tmpdir(), "gh-relay-install-"))
const log = path.join(bin, "calls.log")
afterAll(() => fs.rmSync(bin, { recursive: true, force: true }))

// Stand-ins for podman and curl that record how they were called, so the script runs for real without a server.
fs.writeFileSync(
  path.join(bin, "podman"),
  `#!/usr/bin/env bash\necho "podman $*" >> "${log.split(path.sep).join("/")}"\nif [[ "$1" == "exec" ]]; then echo "tok-123"; fi\nif [[ "$1" == "container" ]]; then exit 1; fi\nexit 0\n`,
)
fs.writeFileSync(
  path.join(bin, "curl"),
  `#!/usr/bin/env bash\necho "curl $*" >> "${log.split(path.sep).join("/")}"\nexit 0\n`,
)
fs.chmodSync(path.join(bin, "podman"), 0o755)
fs.chmodSync(path.join(bin, "curl"), 0o755)

function run(args: string[]) {
  if (fs.existsSync(log)) fs.rmSync(log)
  const r = spawnSync("bash", [script.split(path.sep).join("/"), ...args], {
    env: {
      ...process.env,
      PATH: `${bin.split(path.sep).join("/")}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  })
  return { ...r, calls: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "" }
}

describe("the server install script for the Relay", () => {
  const hasBash = spawnSync("bash", ["--version"]).status === 0

  it.runIf(hasBash)("refuses an address that is not https", () => {
    const r = run(["http://relay.example.com"])
    expect(r.status).toBe(2)
    expect(r.calls).toBe("")
  })

  it.runIf(hasBash)(
    "builds, runs on loopback only with the address, keeps the data volume, and shows the token",
    () => {
      const r = run(["https://relay.example.com"])
      expect(r.status, r.stderr).toBe(0)
      expect(r.calls).toMatch(/podman build -t jcvc-relay -f .*deploy\/relay\/Dockerfile/)
      expect(r.calls).toContain("-p 127.0.0.1:8087:8080")
      expect(r.calls).toContain("-v jcvc-relay-data:/data")
      expect(r.calls).toContain("RELAY_PUBLIC_URL=https://relay.example.com")
      expect(r.calls).not.toMatch(/-p 0\.0\.0\.0|-p 8087:/)
      expect(r.stdout).toContain("tok-123")
    },
  )
})
