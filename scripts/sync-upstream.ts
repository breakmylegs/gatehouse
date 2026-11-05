/**
 * Mac fork: bring upstream's new commits in, and say which of them need Mac work (docs/mac.md, "Keep upstream's
 * features"). Each commit is sorted with upstream's own scripts/platforms.ts, the same as each release's changes.json.
 *
 *   npm run sync:upstream              report, then merge upstream/main into this branch. Nothing is pushed.
 *   npm run sync:upstream -- --check   report only: what is new, what needs Mac work, and whether it would conflict
 *
 * It will not start with uncommitted changes. A merge that conflicts is left for you to finish, with the files named.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { kindOf, parseLog, type Change, type Platform } from "./platforms.js"

const REMOTE = "upstream"
const BRANCH = `${REMOTE}/main`
const checkOnly = process.argv.includes("--check")

const say = (text: string) => console.log(`[sync] ${text}`)
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const fail = (text: string): never => {
  say(text)
  process.exit(1)
}

if (!git("remote").split(/\s+/).includes(REMOTE))
  fail(
    `No ${REMOTE} remote. Add it: git remote add upstream https://github.com/breakmylegs/gatehouse.git`,
  )
if (git("status", "--porcelain")) fail("There are uncommitted changes. Commit or stash them first.")

say("Fetching upstream...")
git("fetch", "--quiet", "--tags", REMOTE)
const count = Number(git("rev-list", "--count", `HEAD..${BRANCH}`))
if (count === 0) {
  say("Up to date with upstream.")
  process.exit(0)
}

const changes = parseLog(
  git("log", `HEAD..${BRANCH}`, "--no-merges", "--format=%x1e%H%x1f%s", "--name-only"),
)
const releases = git("tag", "--merged", BRANCH, "--no-merged", "HEAD", "--sort=version:refname")
  .split("\n")
  .filter(Boolean)
say(`${count} new upstream commits${releases.length ? `, in ${releases.join(", ")}` : ""}.`)

function show(platform: Platform, heading: string, withFiles: boolean) {
  const list: Change[] = changes.filter((c) => c.platform === platform)
  if (!list.length) return
  console.log(`\n${heading} (${list.length})`)
  for (const c of list) {
    console.log(`  ${c.commit.slice(0, 7)} ${c.subject}`)
    if (withFiles)
      for (const f of c.files.filter((f) => kindOf(f) === "windows")) console.log(`      ${f}`)
  }
}
show("all", "Every platform: comes to the Mac as it is", false)
show(
  "mixed",
  "Needs a look: shared code with Windows parts. The shared part comes; does the Windows part (below) need a Mac version?",
  true,
)
show("windows", "Windows only: nothing comes to the Mac. Does the Mac need its own version?", true)
const other = changes.filter((c) => c.platform === "release" || c.platform === "docs").length
if (other) console.log(`\nUpstream's release tools and documents: ${other}`)

// The files the Mac code hooks into ("Mac fork" marks each hook) that upstream has changed: check the hooks after.
const hooked = new Set(
  git("grep", "-l", "Mac fork", "HEAD", "--", "apps", "packages", "scripts")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.replace(/^HEAD:/, "")),
)
const touched = git("diff", "--name-only", `HEAD...${BRANCH}`).split("\n").filter(Boolean)
const hooksTouched = touched.filter((f) => hooked.has(f))
if (hooksTouched.length) {
  console.log("\nUpstream changed files with Mac hooks in them; check each hook is still there:")
  for (const f of hooksTouched) console.log(`  ${f}`)
}

const trial = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", "HEAD", BRANCH], {
  encoding: "utf8",
})
const conflicts =
  trial.status === 1 ? trial.stdout.split("\n\n")[0]!.split("\n").slice(1).filter(Boolean) : []
console.log("")
if (trial.status !== 0 && trial.status !== 1) fail("The trial merge did not run.")
say(
  conflicts.length
    ? `The merge would conflict in: ${conflicts.join(", ")}`
    : "The merge goes in with no conflicts.",
)
if (checkOnly) process.exit(0)

const before = git("rev-parse", "HEAD")
const to = git("rev-parse", "--short", BRANCH)
const merged = spawnSync(
  "git",
  ["merge", "--no-ff", "-m", `merge: upstream to ${to} (${count} commits)`, BRANCH],
  { stdio: "inherit" },
)
if (merged.status !== 0) {
  say(
    "Finish the merge by hand: take upstream's code, then put back each Mac fork hook it replaced.",
  )
  say("Then: git add <files> and git commit. Or start again: git merge --abort")
  process.exit(1)
}
say(`Merged upstream to ${to}.`)
if (git("diff", "--name-only", before, "HEAD", "--", "package-lock.json"))
  say("The dependencies changed: run npm ci.")
say("Next: npm run gate, try it on a Mac, then git push.")
