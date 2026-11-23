/**
 * E-060, backout plan verification (Expansion E5). In a scratch worktree (E-044's, removed junction-safe afterwards),
 * Codehouse proves the change can be backed out: the revert of the change's commits applies cleanly, the project's tests
 * pass after the revert (run as a Codehouse action), and every migration the change adds has a down step that works
 * (E-013's rehearsal). A change whose revert conflicts, whose tests fail after it, or whose new migrations cannot go down
 * is reported as not reversible, with the reason. Your working tree is never touched.
 */
import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { LINKED, removeScratch } from "./bisect.js"
import { projectCommand } from "./claims.js"
import { findMigrations, rehearse } from "./migration-rehearsal.js"

export type BackoutRun = (command: string, cwd: string) => Promise<{ ran: boolean; exitCode: number | null; output: string; refused?: string }>

export interface BackoutResult {
  reversible: boolean
  revert: "clean" | "conflicts" | "nothing to revert"
  tests: "pass" | "fail" | "none" | "not run"
  migrations: "ok" | "irreversible" | "none"
  detail: string
}

const git = (args: string[], cwd: string) =>
  new Promise<{ ok: boolean; out: string }>((resolve) => execFile("git", ["-c", "user.email=codehouse@localhost", "-c", "user.name=Codehouse", ...args], { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => resolve({ ok: !e, out: `${String(out)}${String(err)}` })))

/**
 * Proves, in a scratch worktree, that the change (the commits from `base` to `tip`) can be backed out from where the
 * project stands now (HEAD): later work on top of the change is what makes a revert conflict.
 */
export async function verifyBackout(root: string, base: string, run: BackoutRun, tip = "HEAD"): Promise<BackoutResult> {
  const dir = path.join(os.tmpdir(), `codeh-backout-${crypto.randomBytes(4).toString("hex")}`)
  try {
    const add = await git(["worktree", "add", "--detach", dir, "HEAD"], root)
    if (!add.ok) return { reversible: false, revert: "conflicts", tests: "not run", migrations: "none", detail: `a scratch worktree could not be made: ${add.out.trim().split("\n").at(-1)}` }
    for (const d of LINKED) {
      const from = path.join(root, d)
      if (fs.existsSync(from) && !fs.existsSync(path.join(dir, d))) fs.symlinkSync(from, path.join(dir, d), "junction")
    }
    const commits = (await git(["rev-list", "--no-merges", `${base}..${tip}`], dir)).out.split("\n").map((l) => l.trim()).filter(Boolean)
    if (!commits.length) return { reversible: true, revert: "nothing to revert", tests: "not run", migrations: "none", detail: "the change has no commits of its own to revert." }
    // The migrations the change adds, read before the revert takes them away.
    const added = (await git(["diff", "--name-only", "--diff-filter=A", `${base}..${tip}`], dir)).out.split("\n").map((l) => l.trim().replace(/\\/g, "/")).filter(Boolean)
    const read = (p: string) => {
      try {
        return fs.readFileSync(path.join(dir, p), "utf8")
      } catch {
        return ""
      }
    }
    const newMigrations = findMigrations(added, read)
    const revert = await git(["revert", "--no-edit", ...commits], dir)
    if (!revert.ok) {
      const conflicted = (await git(["diff", "--name-only", "--diff-filter=U"], dir)).out.split("\n").filter(Boolean)
      await git(["revert", "--abort"], dir)
      return { reversible: false, revert: "conflicts", tests: "not run", migrations: "none", detail: `the revert conflicts${conflicted.length ? ` in ${conflicted.slice(0, 5).join(", ")}` : ""}.` }
    }
    const command = projectCommand(dir, "tests")
    let tests: BackoutResult["tests"] = "none"
    if (command) {
      const r = await run(command, dir)
      tests = !r.ran ? "not run" : r.exitCode === 0 ? "pass" : "fail"
    }
    let migrations: BackoutResult["migrations"] = "none"
    if (newMigrations.length) {
      const all = findMigrations(added, read)
      const r = await rehearse(all)
      migrations = r.notRun || r.failures.length || r.irreversible.length ? "irreversible" : "ok"
      if (migrations === "irreversible") return { reversible: false, revert: "clean", tests, migrations, detail: `the change's migrations cannot all go down: ${r.notRun ?? [...r.irreversible.map((n) => `${n} has no working down step`), ...r.failures].join("; ")}.` }
    }
    if (tests === "fail") return { reversible: false, revert: "clean", tests, migrations, detail: `the revert applies cleanly, but the tests fail after it (${command}).` }
    if (tests === "not run") return { reversible: false, revert: "clean", tests, migrations, detail: "the revert applies cleanly, but the tests were not run after it, so it is not proven." }
    return { reversible: true, revert: "clean", tests, migrations, detail: `the revert of ${commits.length} commit(s) applies cleanly${tests === "pass" ? ` and ${command} passes after it` : " (the project has no test command)"}${migrations === "ok" ? ", and the new migrations go down" : ""}.` }
  } finally {
    await removeScratch(root, dir)
  }
}
