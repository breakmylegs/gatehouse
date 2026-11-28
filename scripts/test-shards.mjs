// C-001: the whole test suite one file at a time, as many at once as free memory allows. This laptop has about 16 GB
// and runs other sessions, so a fixed worker count either crawls or runs out of memory. Before each file starts, the
// free memory decides how many may run together; a file that fails is run once more on its own, and the retry is
// logged; a file that fails twice fails the run.
//
//   node scripts/test-shards.mjs              every test file in the workspaces
//   node scripts/test-shards.mjs a.test.ts b.test.ts   just these
//   --commit <sha>          O60: record each file that passes for that commit, and skip those already recorded
//   --budget-minutes <n>    O60: start no file after n minutes; exit 3, to be run again to carry on
//
// O60: a process still running after GATEHOUSE_SHARD_TIMEOUT_MIN minutes (30) is stopped with everything it started,
// and at the end any headless browser a test left behind is stopped and its profile removed.
//
// GATEHOUSE_SHARD_CMD (tests only) replaces the command that runs one file.
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { recordDevCheck } from "./dev-checks.mjs"
import { gateRecord, notePassed } from "./gate-record.mjs"
import { killTree, sweepBrowsers } from "./leftovers.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** What one test file is allowed, and what is kept back for everything else on the computer. */
export const PER_FILE_BYTES = 1.5 * 1024 ** 3
export const RESERVE_BYTES = 2 * 1024 ** 3

/** How many files may run at once with this much memory free: at least one, never more than the cores less one. */
export function workersFor(freeBytes, cpus = os.cpus().length) {
  const byMemory = Math.floor((freeBytes - RESERVE_BYTES) / PER_FILE_BYTES)
  return Math.max(1, Math.min(Math.max(1, cpus - 1), byMemory))
}

/** Every test file under the workspaces' test folders, in a stable order. */
export function listTestFiles(base = root) {
  const out = []
  for (const group of ["apps", "packages"]) {
    const dir = path.join(base, group)
    if (!fs.existsSync(dir)) continue
    for (const ws of fs.readdirSync(dir)) {
      const test = path.join(dir, ws, "test")
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name)
          if (e.isDirectory() && e.name !== "node_modules") walk(full)
          else if (/\.test\.(ts|tsx|mts|js|mjs)$/.test(e.name))
            out.push(path.relative(base, full).split(path.sep).join("/"))
        }
      }
      if (fs.existsSync(test)) walk(test)
    }
  }
  return out.sort()
}

/** Files a process runs together (owner, 12 Nov: each file's own start took most of the test period). */
export const BATCH = 8

/** A run V8 stopped for want of memory (a crash of the process, not a test that failed). */
export const crashedForMemory = (out) =>
  /Fatal process out of memory|exit code 2147483651|memory allocation of \d+ bytes failed|panicked at .*out of memory/.test(out)

/** Waits, up to ten minutes, until the computer has 2.5 GB free (or gives up and lets the try go ahead). */
async function waitForMemory() {
  const until = Date.now() + 10 * 60_000
  while (os.freemem() < 2.5 * 1024 ** 3 && Date.now() < until) await new Promise((r) => setTimeout(r, 10_000))
}

/** How long one process may run before it and everything it started are stopped (O60). */
export const timeoutMs = (env = process.env) => Math.max(1, Number(env.GATEHOUSE_SHARD_TIMEOUT_MIN) || 30) * 60_000

/** One file, or a few together, in a process of its own. */
function runOne(file) {
  const files = Array.isArray(file) ? file : [file]
  const custom = process.env.GATEHOUSE_SHARD_CMD
  const [cmd, args] = custom
    ? [process.execPath, [custom, ...files]]
    : [
        process.execPath,
        [path.join(root, "node_modules", "vitest", "vitest.mjs"), "run", "--maxWorkers=1", ...files],
      ]
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Its own process group off Windows, so a timeout can stop all of it.
      detached: process.platform !== "win32",
    })
    let out = ""
    let timedOut = false
    const limit = timeoutMs()
    const timer = setTimeout(() => {
      timedOut = true
      out += `\n[shards] stopped after ${limit / 60_000} minutes, with everything it started\n`
      killTree(child.pid)
    }, limit)
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0 && !timedOut, out })
    })
  })
}

/**
 * Runs the files, `batch` to a process (one by default), starting the next process only while the free memory allows
 * another. A file that fails is run once more on its own; a batch that fails has each of its files run once more on
 * its own, so a file fails the run only when it fails by itself too. Resolves with the files that failed twice and
 * those that passed only on their retry.
 */
export async function runShards(files, o = {}) {
  const free = o.freemem ?? (() => os.freemem())
  const log = o.log ?? ((l) => console.log(l))
  const run = o.run ?? runOne
  const size = Math.max(1, o.batch ?? 1)
  // O60: a time budget: no file starts after it, and the run says it is incomplete.
  const now = o.now ?? Date.now
  const deadline = o.budgetMs ? now() + o.budgetMs : Infinity
  const passed = o.onPassed ?? (() => undefined)
  let notStarted = 0
  const queue = []
  for (let i = 0; i < files.length; i += size) queue.push(files.slice(i, i + size))
  const failed = []
  const retried = []
  let running = 0
  const alone = async (file) => {
    log(`[shards] retry once: ${file}`)
    retried.push(file)
    let r = await run(file)
    // 28 Nov: a process V8 stopped for want of memory ("Fatal process out of memory", exit 2147483651) has not failed a
    // test: it crashed while the computer was busy, and passed six times in six with it quiet. Up to two more tries,
    // each after memory frees up, said as a crash; a test that fails is still a failure after its one retry.
    for (let more = 0; !r.ok && crashedForMemory(r.out) && more < (o.crashTries ?? 2); more++) {
      log(`[shards] crashed for want of memory, not a test failure; trying again when memory frees up: ${file}`)
      await (o.waitForMemory ?? waitForMemory)()
      r = await run(file)
    }
    if (!r.ok) {
      failed.push(file)
      log(`[shards] FAILED: ${file}\n${r.out.slice(-3000)}`)
    } else passed(file)
  }
  await new Promise((done) => {
    const next = () => {
      if (!queue.length && running === 0) return done()
      if (queue.length && now() >= deadline) {
        notStarted += queue.reduce((n, b) => n + b.length, 0)
        queue.length = 0
        if (running === 0) return done()
      }
      while (queue.length && running < workersFor(free())) {
        const batch = queue.shift()
        running++
        void (async () => {
          const r = await run(batch.length === 1 ? batch[0] : batch)
          if (r.ok) for (const f of batch) passed(f)
          else {
            // The files vitest names as failing; when it names none of them (a crash), all of them.
            const named = batch.filter((f) => new RegExp(`FAIL\\b[^\\n]*${f.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`).test(r.out))
            const suspects = named.length ? named : batch
            // 27 Nov: what the first run said, so a failure that passes on its retry can still be understood.
            log(`[shards] ${named.length ? "failed" : "stopped without naming a file"} on its first run: ${batch.join(", ")}\n${r.out.slice(-1500)}`)
            for (const file of suspects) await alone(file)
            // The others in a failed batch passed in it.
            for (const file of batch) if (!suspects.includes(file)) passed(file)
          }
          running--
          next()
        })()
      }
    }
    next()
  })
  return { failed, retried, passedOnRetry: retried.filter((f) => !failed.includes(f)), notStarted }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const take = (flag) => {
    const i = argv.indexOf(flag)
    if (i < 0) return undefined
    const v = argv[i + 1]
    argv.splice(i, 2)
    return v
  }
  const commit = take("--commit")
  const budget = Number(take("--budget-minutes")) || 0
  const given = argv
  const all = given.length ? given : listTestFiles()
  // O60: for a commit, what already passed for it is not run again.
  const done = commit ? new Set(gateRecord(commit)?.passed ?? []) : new Set()
  const files = all.filter((f) => !done.has(f))
  const started = Date.now()
  console.log(
    `[shards] ${files.length} test files${done.size ? ` (${all.length - files.length} already passed for ${commit.slice(0, 12)})` : ""}, at most ${workersFor(os.freemem())} at once to start with`,
  )
  let r
  try {
    r = await runShards(files, {
      batch: BATCH,
      ...(budget ? { budgetMs: budget * 60_000 } : {}),
      ...(commit ? { onPassed: (f) => notePassed(commit, f) } : {}),
    })
  } finally {
    // O60: whatever a test left running (a headless browser, its profile) goes when the run ends, however it ends.
    sweepBrowsers()
  }
  const secs = Math.round((Date.now() - started) / 1000)
  for (const f of r.passedOnRetry) {
    console.log(`[shards] passed on its retry (logged as flaky): ${f}`)
    // E-099: kept for the health score's flaky files.
    recordDevCheck("flaky", { file: f })
  }
  if (r.failed.length) console.log(`[shards] FAILED: ${r.failed.length} of ${files.length} files, in ${secs}s`)
  else if (r.notStarted)
    console.log(`[shards] stopped at the ${budget}-minute budget: ${files.length - r.notStarted} of ${files.length} files run, ${r.notStarted} to go; run it again to carry on`)
  else console.log(`[shards] passed: ${files.length} files, in ${secs}s`)
  process.exit(r.failed.length ? 1 : r.notStarted ? 3 : 0)
}
