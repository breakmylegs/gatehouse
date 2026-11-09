// C-001: the whole test suite one file at a time, as many at once as free memory allows. This laptop has about 16 GB
// and runs other sessions, so a fixed worker count either crawls or runs out of memory. Before each file starts, the
// free memory decides how many may run together; a file that fails is run once more on its own, and the retry is
// logged; a file that fails twice fails the run.
//
//   node scripts/test-shards.mjs              every test file in the workspaces
//   node scripts/test-shards.mjs a.test.ts b.test.ts   just these
//
// GATEHOUSE_SHARD_CMD (tests only) replaces the command that runs one file.
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

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

function runOne(file) {
  const custom = process.env.GATEHOUSE_SHARD_CMD
  const [cmd, args] = custom
    ? [process.execPath, [custom, file]]
    : [
        process.execPath,
        [path.join(root, "node_modules", "vitest", "vitest.mjs"), "run", "--maxWorkers=1", file],
      ]
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    child.on("close", (code) => resolve({ ok: code === 0, out }))
  })
}

/**
 * Runs the files, starting the next only while the free memory allows another, retrying each failure once. Resolves
 * with the files that failed twice and those that passed only on their retry.
 */
export async function runShards(files, o = {}) {
  const free = o.freemem ?? (() => os.freemem())
  const log = o.log ?? ((l) => console.log(l))
  const run = o.run ?? runOne
  const queue = [...files]
  const failed = []
  const retried = []
  let running = 0
  await new Promise((done) => {
    const next = () => {
      if (!queue.length && running === 0) return done()
      while (queue.length && running < workersFor(free())) {
        const file = queue.shift()
        running++
        void (async () => {
          let r = await run(file)
          if (!r.ok) {
            log(`[shards] retry once: ${file}`)
            retried.push(file)
            r = await run(file)
            if (!r.ok) {
              failed.push(file)
              log(`[shards] FAILED: ${file}\n${r.out.slice(-3000)}`)
            }
          }
          running--
          next()
        })()
      }
    }
    next()
  })
  return { failed, retried, passedOnRetry: retried.filter((f) => !failed.includes(f)) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const given = process.argv.slice(2)
  const files = given.length ? given : listTestFiles()
  const started = Date.now()
  console.log(
    `[shards] ${files.length} test files, at most ${workersFor(os.freemem())} at once to start with`,
  )
  const r = await runShards(files)
  const secs = Math.round((Date.now() - started) / 1000)
  for (const f of r.passedOnRetry)
    console.log(`[shards] passed on its retry (logged as flaky): ${f}`)
  console.log(
    r.failed.length
      ? `[shards] FAILED: ${r.failed.length} of ${files.length} files, in ${secs}s`
      : `[shards] passed: ${files.length} files, in ${secs}s`,
  )
  process.exit(r.failed.length ? 1 : 0)
}
