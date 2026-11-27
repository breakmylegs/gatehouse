// O60 (owner, 27 Nov): what the full gate has passed for one exact commit, so a gate longer than the two hours a
// background run is given carries on where it stopped, and a release of that commit accepts it. Kept in Gatehouse's
// data folder (gate/<commit>.json), written atomically; a record is only ever for a clean tree at that commit.
import fs from "node:fs"
import path from "node:path"
import { dataDir } from "./heavy-lock.mjs"

const DIR = (env = process.env) => path.join(dataDir(env), "gate")
const fileFor = (commit, env) => path.join(DIR(env), `${commit.replace(/[^0-9a-f]/gi, "").slice(0, 64)}.json`)

/** The record for a commit: { commit, passed: files, steps: names, complete }, or undefined. */
export function gateRecord(commit, env = process.env) {
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) return undefined
  try {
    const r = JSON.parse(fs.readFileSync(fileFor(commit, env), "utf8"))
    return r && r.commit === commit ? { passed: [], steps: [], complete: false, ...r } : undefined
  } catch {
    return undefined
  }
}

function write(commit, change, env = process.env) {
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) return
  const now = gateRecord(commit, env) ?? { commit, passed: [], steps: [], complete: false, started: new Date().toISOString() }
  const next = change(now)
  const file = fileFor(commit, env)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.mkdirSync(DIR(env), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify({ ...next, updated: new Date().toISOString() }, null, 1))
    // 27 Nov: Windows refused the rename now and then (EPERM, the record held open a moment by something else, the
    // virus scanner most likely), which stopped the whole test run. Tried again for a while; never fatal.
    for (let i = 0; ; i++) {
      try {
        fs.renameSync(tmp, file)
        return
      } catch (e) {
        if (i >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1))
      }
    }
  } catch (e) {
    // A record not written only means a rerun runs that again: the run itself goes on.
    console.log(`[gate-record] could not note it for ${commit.slice(0, 12)} (${e.code ?? e.message}); a rerun will run it again`)
    fs.rmSync(tmp, { force: true })
  }
}

/** A test file passed for this commit. */
export const notePassed = (commit, file, env) =>
  write(commit, (r) => (r.passed.includes(file) ? r : { ...r, passed: [...r.passed, file].sort() }), env)

/** A step (a typecheck, the lint) passed for this commit. */
export const noteStep = (commit, step, env) =>
  write(commit, (r) => (r.steps.includes(step) ? r : { ...r, steps: [...r.steps, step].sort() }), env)

/** Every step and every test file passed for this commit: the full gate is complete. */
export const noteComplete = (commit, env) => write(commit, (r) => ({ ...r, complete: true }), env)

/** Records older than 30 days go, so the folder does not grow. */
export function pruneRecords(env = process.env, now = Date.now()) {
  try {
    for (const f of fs.readdirSync(DIR(env))) {
      const full = path.join(DIR(env), f)
      if (now - fs.statSync(full).mtimeMs > 30 * 86_400_000) fs.rmSync(full, { force: true })
    }
  } catch {
    // no folder yet
  }
}
