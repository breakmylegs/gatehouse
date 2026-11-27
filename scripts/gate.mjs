// The gate before a push: checks what a change can affect, not everything.
//
//   npm run gate                  changes since origin/main, committed or not, including new files
//   npm run gate -- --base v1.0.80  changes since a release tag (npm run release uses the last one)
//   npm run gate -- --full        everything: for a dependency or build-config change, or when asked
//   npm run gate -- --dry         say what would run, run nothing
//   npm run gate -- --related     also every test that reaches a changed file through other files (owner, 13 Nov: only
//                                 for a change to a module nearly everything relies on, saying why)
//
// What it runs, and why:
//   0. Always: the prohibited-pattern check (scripts/forbidden.mjs: claude.ai's private API, debugging ports, browser
//      automation, cookie stores, the Claude app's own data).
//   1. Typecheck: the workspaces the change touches, and the workspaces that depend on them.
//   2. Lint: the changed files only.
//   3. Tests that import a changed file themselves, or are named after it (scripts/related-tests.mjs, directTests);
//      with --related, every test that reaches one through other files. Eight files to a process when memory is short.
//   4. Tests that name a changed file that is not code (a C# file, a rules file, a script, a document), and any
//      changed test file itself.
//   5. Always: the security invariant tests (invariants.test.ts, threat-model.test.ts) and the provider conformance
//      suite (providers.test.ts, conformance.test.ts: owner delegated, 2 Nov, a provider that fails it is never released),
//      which are quick and guard
//      what must never break.
// A change to package.json, the lockfile, a tsconfig or the vitest or eslint config runs everything.
//
// O60 (owner, 27 Nov): everything takes longer than a background run's two hours, so on a clean tree it records what
// passed for that exact commit (scripts/gate-record.mjs) and a rerun carries on from there; --budget-minutes <n> stops
// the tests cleanly after n minutes (exit 3: run it again to carry on). A release of the commit accepts a complete
// record. Only one such run happens on this computer at a time (scripts/heavy-lock.mjs); a second waits its turn.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { directTests, relatedTests } from "./related-tests.mjs"
import { recordDevCheck } from "./dev-checks.mjs"
import { gateRecord, noteComplete, noteStep, pruneRecords } from "./gate-record.mjs"
import { heavyLock } from "./heavy-lock.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valueOf = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined)
const dry = has("--dry")
const say = (t) => console.log(`[gate] ${t}`)
const node = process.execPath
const bin = (rel) => path.join(root, "node_modules", ...rel.split("/"))

const ALWAYS = [
  "apps/host/test/invariants.test.ts",
  "apps/host/test/threat-model.test.ts",
  "apps/host/test/providers.test.ts",
  "apps/host/test/conformance.test.ts",
]
const FULL_IF = [
  /^package-lock\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /^vitest\.config\.[cm]?[jt]s$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^\.npmrc$/,
]

function git(...a) {
  const r = spawnSync("git", a, { cwd: root, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.trim()}`)
  return r.stdout.split(/\r?\n/).filter(Boolean)
}

function run(label, cmd, cmdArgs, { retryFlaky = false, stream = false } = {}) {
  say(label)
  if (dry) return 0
  const started = Date.now()
  // O60: a long step (all the tests) shows its own progress as it goes, instead of holding it back until the end.
  if (stream) {
    const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: ["ignore", "inherit", "inherit"] })
    say(`  ${r.status === 0 ? "passed" : r.status === 3 ? "stopped at its time budget" : "FAILED"} in ${Math.round((Date.now() - started) / 1000)}s`)
    return r.status ?? 1
  }
  // A retry replaces the worker count instead of adding a second one, which vitest refuses (30 Oct: the retry
  // failed at once with "Expected a single value for option --maxWorkers").
  const once = (extra = []) =>
    spawnSync(
      cmd,
      [
        ...cmdArgs.filter(
          (a) => !(extra.some((x) => x.startsWith("--maxWorkers")) && a.startsWith("--maxWorkers")),
        ),
        ...extra,
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
  let r = once()
  let out = (r.stdout ?? "") + (r.stderr ?? "")
  // This machine sometimes cannot start test workers under load. That is not a failure of the code: run once more,
  // one worker at a time, and say so.
  if (
    retryFlaky &&
    r.status !== 0 &&
    // 10 Nov: also "Worker exited unexpectedly with exit code 3221225794 during starting state" (0xC0000142, a
    // process Windows could not start while memory was short).
    // And "... during started state while running test file" (0x80000003, a worker that died part way, memory short).
    /Failed to start forks worker|Timeout waiting for worker|Worker exited unexpectedly with exit code \d+ during start(ing|ed) state/.test(out)
  ) {
    say("  the test workers did not start (machine busy); running again, one at a time")
    r = once(["--maxWorkers=1"])
    out = (r.stdout ?? "") + (r.stderr ?? "")
  }
  const secs = Math.round((Date.now() - started) / 1000)
  const summary = out
    .split(/\r?\n/)
    .filter((l) => /Test Files|Tests\s|FAIL|error TS|✖|problems?\)|\[shards\] (passed|retry)/.test(l))
    .slice(0, 25)
  for (const l of summary) console.log(`  ${l.trim()}`)
  say(`  ${r.status === 0 ? "passed" : "FAILED"} in ${secs}s`)
  // A failure the summary does not name (a test file that crashed, an unhandled error, a worker that died) shows
  // its own output, or the run fails with nothing to go on (30 Oct: "72 passed (73)" and no FAIL line).
  if (r.status !== 0 && !summary.some((l) => /FAIL|error TS|✖|problems?\)/.test(l)))
    console.log(out.slice(-4000))
  // A file that failed twice in its own process: what it said, or there is nothing to go on (10 Nov, six such files
  // in the release passed on their own minutes later, and their errors were not kept).
  else if (r.status !== 0 && summary.some((l) => /\[shards\] FAILED/.test(l))) console.log(out.slice(-12000))
  return r.status ?? 1
}

// What changed: committed since the base, staged, unstaged and new files.
const base =
  valueOf("--base") ??
  (spawnSync("git", ["rev-parse", "--verify", "origin/main"], { cwd: root }).status === 0
    ? "origin/main"
    : "HEAD")
const changed = [
  ...new Set([
    ...git("diff", "--name-only", `${base}...HEAD`),
    ...git("diff", "--name-only", "HEAD"),
    ...git("ls-files", "--others", "--exclude-standard"),
  ]),
].sort()
const present = changed.filter((f) => fs.existsSync(path.join(root, f)))
// A package.json counts only when what it installs changed (dependencies, overrides, workspaces), not its scripts.
const installs = (text) => {
  try {
    const j = JSON.parse(text)
    return JSON.stringify([
      j.dependencies,
      j.devDependencies,
      j.optionalDependencies,
      j.overrides,
      j.workspaces,
    ])
  } catch {
    return "unreadable"
  }
}
const depsChanged = (f) => {
  const before = spawnSync("git", ["show", `${base}:${f}`], { cwd: root, encoding: "utf8" })
  const now = fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : ""
  return before.status !== 0 || installs(before.stdout) !== installs(now)
}
// 11 Nov: with memory short, the related tests' two long-lived workers died part way, and so did whatever came after
// them, five releases in a row. Each file in a process of its own as memory allows (C-001) gets through. Owner, 12 Nov
// ("the testing period has grown very large"): that used to mean every test file, over an hour and a half; now it is
// only the files the change reaches (scripts/related-tests.mjs reads the imports), each in a process of its own.
const SHORT_OF_MEMORY = 4 * 1024 ** 3
const shortOfMemory = os.freemem() < SHORT_OF_MEMORY
const fullReason = has("--full")
  ? "asked for"
  : (changed.find((f) => FULL_IF.some((re) => re.test(f))) ??
    changed.filter((f) => /(^|\/)package\.json$/.test(f)).find((f) => depsChanged(f)))
say(`${changed.length} file${changed.length === 1 ? "" : "s"} changed since ${base}`)

// Workspaces and who depends on whom, from their package.json files.
const workspaces = ["apps", "packages"].flatMap((d) =>
  fs
    .readdirSync(path.join(root, d), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, d, e.name, "package.json")))
    .map((e) => `${d}/${e.name}`),
)
const pkgName = new Map()
const deps = new Map()
for (const w of workspaces) {
  const p = JSON.parse(fs.readFileSync(path.join(root, w, "package.json"), "utf8"))
  pkgName.set(p.name, w)
  deps.set(
    w,
    Object.keys({ ...p.dependencies, ...p.devDependencies }).filter((n) =>
      n.startsWith("@gatehouse/"),
    ),
  )
}
const touched = new Set(workspaces.filter((w) => changed.some((f) => f.startsWith(w + "/"))))
let grew = true
while (grew) {
  grew = false
  for (const w of workspaces)
    if (!touched.has(w) && deps.get(w).some((n) => touched.has(pkgName.get(n)))) {
      touched.add(w)
      grew = true
    }
}

const failures = []
// 0. Always: nothing Anthropic's terms or Codehouse's rules forbid is in the tree (CH-01). It takes a second.
if (run("prohibited patterns", node, [path.join(root, "scripts", "forbidden.mjs")]) !== 0)
  failures.push("prohibited patterns")
let incomplete = false
if (fullReason) {
  say(`running everything (${fullReason})`)
  // O60 (owner, 27 Nov): one heavy run at a time on this computer; a second waits its turn and says for what.
  if (!dry) await heavyLock(`the full gate in ${root}`, { say })
  // O60: on a clean tree, what passes is recorded for this exact commit, and a rerun carries on from there, so a gate
  // longer than a background run's two hours still finishes; a release of the commit accepts the complete record.
  const commit = !dry && git("status", "--porcelain").length === 0 ? git("rev-parse", "HEAD")[0] : undefined
  const record = commit ? gateRecord(commit) : undefined
  if (commit) say(record ? `carrying on for ${commit.slice(0, 12)}: ${record.steps.length} steps and ${record.passed.length} test files passed already` : `recording for ${commit.slice(0, 12)}`)
  else if (!dry) say("the tree has changes, so nothing is recorded: a rerun starts again")
  const step = (name, fn) => {
    if (record?.steps.includes(name)) return say(`${name}: passed already for this commit`)
    if (fn() !== 0) failures.push(name)
    else if (commit) noteStep(commit, name)
  }
  for (const w of workspaces)
    if (fs.existsSync(path.join(root, w, "tsconfig.json")))
      step(`typecheck ${w}`, () => run(`typecheck: ${w}`, node, [bin("typescript/bin/tsc"), "-p", path.join(w, "tsconfig.json"), "--noEmit"]))
  step("lint", () => run("lint: everything", node, [bin("eslint/bin/eslint.js"), "."]))
  // C-001: one file per process, as many at once as free memory allows, each failure retried once and logged. O60: its
  // progress is shown as it goes, and --budget-minutes stops it cleanly before a time limit, to be run again.
  const budget = valueOf("--budget-minutes")
  const shards = run(
    "tests: all, one file at a time by free memory",
    node,
    [path.join(root, "scripts", "test-shards.mjs"), ...(commit ? ["--commit", commit] : []), ...(budget ? ["--budget-minutes", budget] : [])],
    { stream: true },
  )
  if (shards === 3) incomplete = true
  else if (shards !== 0) failures.push("tests")
  if (commit && !failures.length && !incomplete) {
    noteComplete(commit)
    say(`the full gate is complete for ${commit.slice(0, 12)}; a release of this commit accepts it`)
  }
  pruneRecords()
} else {
  // 1. Typecheck.
  for (const w of [...touched].sort())
    if (fs.existsSync(path.join(root, w, "tsconfig.json")))
      if (
        run(`typecheck: ${w}`, node, [
          bin("typescript/bin/tsc"),
          "-p",
          path.join(w, "tsconfig.json"),
          "--noEmit",
        ]) !== 0
      )
        failures.push(`typecheck ${w}`)
  const scriptsTs = present.filter((f) => /^scripts\/[^/]+\.ts$/.test(f))
  if (scriptsTs.length)
    if (
      run(`typecheck: ${scriptsTs.join(", ")}`, node, [
        bin("typescript/bin/tsc"),
        "--noEmit",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--target",
        "es2023",
        "--strict",
        "--skipLibCheck",
        "--types",
        "node",
        ...scriptsTs,
      ]) !== 0
    )
      failures.push("typecheck scripts")

  // 2. Lint.
  const lintable = present.filter((f) => /\.(ts|tsx|mts|mjs|js|cjs)$/.test(f))
  if (lintable.length)
    if (
      run(`lint: ${lintable.length} changed file${lintable.length === 1 ? "" : "s"}`, node, [
        bin("eslint/bin/eslint.js"),
        "--no-warn-ignored",
        ...lintable,
      ]) !== 0
    )
      failures.push("lint")

  // 3 to 5. Tests.
  const isTest = (f) => /\.test\.(ts|tsx)$/.test(f)
  const sources = present.filter(
    (f) => /\.(ts|tsx|mts|mjs)$/.test(f) && !isTest(f) && /^(apps|packages)\//.test(f),
  )
  const testFiles = execList()
  const named = new Set(present.filter(isTest))
  // Files that are not imported but are read or run by tests: C# sources, rules, PowerShell, styles, scripts.
  // Documents are left out: a test naming README.md uses it as sample data, not as what it tests. The one document
  // a test checks, the threat model, is checked on every run anyway.
  const others = present.filter(
    (f) => (!/\.(ts|tsx|mts|mjs)$/.test(f) || /^scripts\//.test(f)) && !/\.md$/i.test(f),
  )
  const why = new Map()
  for (const f of others) {
    const nameOnly = path.basename(f)
    for (const t of testFiles) {
      if (named.has(t)) continue
      if (fs.readFileSync(path.join(root, t), "utf8").includes(nameOnly)) {
        named.add(t)
        why.set(t, f)
      }
    }
  }
  for (const t of ALWAYS) named.add(t)
  for (const t of named) if (!why.has(t)) why.set(t, ALWAYS.includes(t) ? "always" : "changed")

  // Owner's testing standard (13 Nov, global CLAUDE.md): the changed tests, the regression tests for what the change
  // touches (tests that import a changed file themselves, or are named after it), and the ones always run. The whole
  // import graph (every test that reaches a changed file through other files) only with --related, which says so: one
  // fix had reached 237 test files that way.
  const broad = has("--related")
  const reached = sources.length ? (broad ? relatedTests(sources) : directTests(sources)) : []
  if (broad) say("tests: every one that reaches a changed file through its imports (--related)")
  const list = [...new Set([...reached, ...named])].sort()
  for (const t of named) if (why.get(t) !== "changed") say(`  + ${t} (${why.get(t)})`)
  if (list.length) {
    const label = `tests: ${list.length} (${reached.length} for the changed code, the rest named by the change or always run)`
    const code = shortOfMemory
      ? run(`${label}, eight files to a process as free memory allows`, node, [path.join(root, "scripts", "test-shards.mjs"), ...list])
      : run(label, node, [bin("vitest/vitest.mjs"), "run", "--maxWorkers=2", ...list], { retryFlaky: true })
    if (code !== 0) failures.push("tests")
  }
  const window = present.filter((f) =>
    /^packaging\/(CodehouseApp|Overlay|Popout|Hotkey|NavGuard|Capture|Backdrop|Common|Launcher|Helper|Limits)\.cs$|^scripts\/package\.mjs$|^packaging\/installer\.iss$/.test(
      f,
    ),
  )
  if (window.length)
    say(
      `the window, launcher or package changed (${window.join(", ")}): also run npm run package:check`,
    )
}

function execList() {
  const out = []
  for (const w of workspaces) {
    const dir = path.join(root, w, "test")
    if (!fs.existsSync(dir)) continue
    for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true }))
      if (e.isFile() && /\.test\.(ts|tsx)$/.test(e.name))
        out.push(path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
  }
  return out
}

say(
  failures.length
    ? `FAILED: ${failures.join(", ")}`
    : dry
      ? "dry run: nothing was run"
      : incomplete
        ? "not finished: the tests stopped at their time budget; run the gate again to carry on"
        : "passed",
)
// E-099: each gate's result, for the health score (a dry run, or one not finished, is not a result).
if (!dry && !incomplete) recordDevCheck("gates", { ok: failures.length === 0 })
process.exit(failures.length ? 1 : incomplete ? 3 : 0)
