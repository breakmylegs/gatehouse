// Owner, 18 Nov: CNW updates on its server in one command, scripts/update.sh. It is executable in git, passes
// shellcheck, names the right compose files, and, run for real against a throwaway clone with a stand-in for docker:
// pulls and reports the old and new commit and the protocol when CNW comes up healthy, and when it does not, goes back
// to the commit from before, rebuilds it, and says that it rolled back.
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const REPO = path.resolve(import.meta.dirname, "../../..")
const SCRIPT = path.join(REPO, "scripts", "update.sh")
const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore", shell: false }).status === 0
const bash = has("bash", ["-c", "exit 0"])
const shellcheck = has("shellcheck", ["--version"])
// Git on this kind of machine may run a file-system monitor and turn LF into CRLF on checkout, which would break the
// script in the clone: both are off for these runs only.
const GIT_ENV = { ...process.env, GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "core.autocrlf", GIT_CONFIG_VALUE_1: "false" }
// A Windows path as bash on Windows reads it (C:\x becomes /c/x); unchanged elsewhere.
const posix = (p: string) => (process.platform === "win32" ? p.replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, "/") : p)

describe("scripts/update.sh", () => {
  it("is executable in git, stops on the first error, and names the compose files CNW is set up with", () => {
    expect(execFileSync("git", ["ls-files", "-s", "scripts/update.sh"], { cwd: REPO, encoding: "utf8" })).toMatch(/^100755 /)
    const text = fs.readFileSync(SCRIPT, "utf8")
    expect(text).toMatch(/^#!\/usr\/bin\/env bash\n/)
    expect(text).toContain("set -euo pipefail")
    expect(text).not.toContain("\r")
    for (const f of ["compose.yml", "compose.own-proxy.yml"]) {
      expect(text).toContain(f)
      expect(fs.existsSync(path.join(REPO, "docker", "cnw", f)), f).toBe(true)
    }
    expect(text).toContain("--progress plain up -d --build")
  })

  it.skipIf(!shellcheck)("passes shellcheck", () => {
    const r = spawnSync("shellcheck", ["-x", SCRIPT], { encoding: "utf8" })
    expect(r.stdout + r.stderr).toBe("")
    expect(r.status).toBe(0)
  })

  // Git is slow in a new repository on some machines (a virus scanner reading each file), so each run has time.
  describe.skipIf(!bash)("run against a throwaway clone", () => {
    let dir: string
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-update-"))
    })
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

    /** An origin with two commits, a clone at the first, and a stand-in docker that is healthy only at one of them. */
    function setUp(o: { ownProxy?: boolean; healthyAtNew: boolean }) {
      const g = (cwd: string, ...a: string[]) =>
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8", env: GIT_ENV }).trim()
      const origin = path.join(dir, "origin")
      fs.mkdirSync(path.join(origin, "scripts"), { recursive: true })
      fs.mkdirSync(path.join(origin, "docker", "cnw"), { recursive: true })
      fs.copyFileSync(SCRIPT, path.join(origin, "scripts", "update.sh"))
      fs.writeFileSync(path.join(origin, "docker", "cnw", "compose.yml"), "services: {}\n")
      fs.writeFileSync(path.join(origin, "docker", "cnw", "compose.own-proxy.yml"), "services: {}\n")
      fs.writeFileSync(path.join(origin, ".gitignore"), "docker/cnw/.env\n")
      g(origin, "init", "-q")
      g(origin, "add", "-A")
      g(origin, "update-index", "--chmod=+x", "scripts/update.sh")
      g(origin, "commit", "-qm", "the version running now")
      const clone = path.join(dir, "clone")
      g(dir, "clone", "-q", origin, clone)
      fs.writeFileSync(path.join(origin, "NEW"), "x")
      g(origin, "add", "-A")
      g(origin, "commit", "-qm", "the update")
      const oldCommit = g(clone, "rev-parse", "HEAD")
      const newCommit = g(origin, "rev-parse", "HEAD")
      if (o.ownProxy) fs.writeFileSync(path.join(clone, "docker", "cnw", ".env"), "COMPOSE_FILE=compose.yml:compose.own-proxy.yml\nCNW_HOST=cnw.example.org\n")
      const bin = path.join(dir, "bin")
      fs.mkdirSync(bin)
      const log = path.join(dir, "docker.log")
      // Healthy only at the chosen commit: the clone's HEAD decides, as a real build of it would.
      const good = o.healthyAtNew ? newCommit : oldCommit
      fs.writeFileSync(
        path.join(bin, "docker"),
        [
          "#!/usr/bin/env bash",
          `echo "docker $*" >> "${posix(log)}"`,
          'case "$*" in',
          "  info) exit 0 ;;",
          '  *"ps -q cnw"*) echo c0ffee ;;',
          `  inspect*) if [ "$(git -C "${posix(clone)}" rev-parse HEAD)" = "${good}" ]; then echo healthy; else echo unhealthy; fi ;;`,
          '  *"exec -T cnw wget"*) echo \'{"version":"1.2.0","protocol":2}\' ;;',
          "esac",
          "",
        ].join("\n"),
        { mode: 0o755 },
      )
      const run = () =>
        spawnSync("bash", ["-c", `export PATH="${posix(bin)}:$PATH"; cd / && "${posix(path.join(clone, "scripts", "update.sh"))}"`], { encoding: "utf8", timeout: 240_000, env: GIT_ENV })
      return { log, oldCommit, newCommit, run, head: () => g(clone, "rev-parse", "HEAD") }
    }

    it("pulls, rebuilds with the whole build shown, waits for health, and prints both commits and the protocol", { timeout: 300_000 }, () => {
      const s = setUp({ ownProxy: true, healthyAtNew: true })
      const r = s.run()
      expect(r.status, r.stdout + r.stderr).toBe(0)
      expect(s.head()).toBe(s.newCommit)
      // .env says CNW is behind your own proxy, so its compose file is used too.
      expect(fs.readFileSync(s.log, "utf8")).toMatch(/docker compose -f compose\.yml -f compose\.own-proxy\.yml --progress plain up -d --build/)
      expect(r.stdout).toMatch(/CNW is healthy/)
      expect(r.stdout).toContain(`Before:   ${s.oldCommit.slice(0, 7)}`)
      expect(r.stdout).toContain(`Now:      ${s.newCommit.slice(0, 7)}`)
      expect(r.stdout).toMatch(/CNW 1\.2\.0, protocol 2/)
    })

    it("goes back to the commit from before when CNW does not come up healthy, rebuilds it, and says so", { timeout: 300_000 }, () => {
      const s = setUp({ healthyAtNew: false })
      const r = s.run()
      expect(r.status, r.stdout + r.stderr).toBe(1)
      expect(s.head()).toBe(s.oldCommit)
      expect(r.stdout).toMatch(/ROLLING BACK/)
      expect(r.stdout).toMatch(/ROLLED BACK: CNW runs the commit from before the update again, and is healthy/)
      const log = fs.readFileSync(s.log, "utf8")
      expect(log.match(/up -d --build/g)).toHaveLength(2)
      // With no .env for your own proxy, the bundled caddy's compose file alone.
      expect(log).toMatch(/docker compose -f compose\.yml --progress plain/)
      expect(log).not.toContain("own-proxy")
    })
  })
})
