// The gate before a push: checks what a change can affect, not everything.
//
//   npm run gate                  changes since origin/main, committed or not, including new files
//   npm run gate -- --base v1.0.80  changes since a release tag (npm run release uses the last one)
//   npm run gate -- --full        everything: for a dependency or build-config change, or when asked
//   npm run gate -- --dry         say what would run, run nothing
//
// What it runs, and why:
//   1. Typecheck: the workspaces the change touches, and the workspaces that depend on them.
//   2. Lint: the changed files only.
//   3. Tests whose code imports a changed file, directly or through other files (vitest related, which follows
//      the import graph).
//   4. Tests that name a changed file that is not code (a C# file, a rules file, a script, a document), and any
//      changed test file itself.
//   5. Always: the security invariant tests (invariants.test.ts, threat-model.test.ts), which are quick and guard
//      what must never break.
// A change to package.json, the lockfile, a tsconfig or the vitest or eslint config runs everything.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valueOf = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined)
const dry = has("--dry")
const say = (t) => console.log(`[gate] ${t}`)
const node = process.execPath
const bin = (rel) => path.join(root, "node_modules", ...rel.split("/"))

const ALWAYS = ["apps/host/test/invariants.test.ts", "apps/host/test/threat-model.test.ts"]
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

function run(label, cmd, cmdArgs, { retryFlaky = false } = {}) {
  say(label)
  if (dry) return 0
  const started = Date.now()
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
    /Failed to start forks worker|Timeout waiting for worker/.test(out)
  ) {
    say("  the test workers did not start (machine busy); running again, one at a time")
    r = once(["--maxWorkers=1"])
    out = (r.stdout ?? "") + (r.stderr ?? "")
  }
  const secs = Math.round((Date.now() - started) / 1000)
  const summary = out
    .split(/\r?\n/)
    .filter((l) => /Test Files|Tests\s|FAIL|error TS|✖|problems?\)/.test(l))
    .slice(0, 25)
  for (const l of summary) console.log(`  ${l.trim()}`)
  say(`  ${r.status === 0 ? "passed" : "FAILED"} in ${secs}s`)
  if (r.status !== 0 && summary.length === 0) console.log(out.slice(-4000))
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
if (fullReason) {
  say(`running everything (${fullReason})`)
  for (const w of workspaces)
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
  if (run("lint: everything", node, [bin("eslint/bin/eslint.js"), "."]) !== 0) failures.push("lint")
  if (
    run("tests: all", node, [bin("vitest/vitest.mjs"), "run", "--maxWorkers=2"], {
      retryFlaky: true,
    }) !== 0
  )
    failures.push("tests")
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

  let ranRelated = new Set()
  if (sources.length) {
    const report = path.join(os.tmpdir(), `jcvc-gate-${process.pid}.json`)
    const code = run(
      `tests: those that import any of ${sources.length} changed source file${sources.length === 1 ? "" : "s"}`,
      node,
      [
        bin("vitest/vitest.mjs"),
        "related",
        "--run",
        "--passWithNoTests",
        "--maxWorkers=2",
        "--reporter=default",
        "--reporter=json",
        `--outputFile=${report}`,
        ...sources,
      ],
      { retryFlaky: true },
    )
    if (code !== 0) failures.push("related tests")
    try {
      const j = JSON.parse(fs.readFileSync(report, "utf8"))
      ranRelated = new Set(
        j.testResults.map((r) => path.relative(root, r.name).split(path.sep).join("/")),
      )
      fs.rmSync(report, { force: true })
    } catch {
      // no report: run the named ones anyway
    }
  }
  const rest = [...named].filter((t) => !ranRelated.has(t)).sort()
  if (rest.length) {
    for (const t of rest) say(`  + ${t} (${why.get(t)})`)
    if (
      run(
        `tests: ${rest.length} named by the change or always run`,
        node,
        [bin("vitest/vitest.mjs"), "run", "--maxWorkers=2", ...rest],
        { retryFlaky: true },
      ) !== 0
    )
      failures.push("named tests")
  }
  const window = present.filter((f) =>
    /^packaging\/(JCVCApp|Common|Launcher)\.cs$|^scripts\/package\.mjs$|^packaging\/installer\.iss$/.test(
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
  failures.length ? `FAILED: ${failures.join(", ")}` : dry ? "dry run: nothing was run" : "passed",
)
process.exit(failures.length ? 1 : 0)
