// Builds a folder you can run, copy or zip:
//
//   dist-app/JCVC/
//     JCVC.exe        the Gatehouse window (WebView2), compiled from packaging/JCVCApp.cs with the compiler that ships with Windows
//     JCVC-Console.exe  the same Host in a console window, for troubleshooting
//     Microsoft.Web.WebView2.*.dll, WebView2Loader.dll   Microsoft's WebView2 libraries, fetched from NuGet
//     runtime/node.exe     the Node it runs on
//     app/                 the application and its production node_modules
//     README.txt
//     JCVC-Update.exe  switches to a new version after JCVC closes (packaging/Updater.cs)
//     release.json     the version and the hash of each part (scripts/release.ts stamp)
//
// Usage: node scripts/package.mjs [--skip-build] [--check] [--zip] [--out <folder>]
//   --skip-build  reuse apps/web/dist and apps/phone/dist as they are
//   --check       afterwards run `JCVC.exe --check` against the packaged copy
//   --exe-only    only recompile the exes into an existing dist-app/JCVC (quick, for working on the launcher)
//   --zip         also make dist-app/JCVC.zip
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const outIdx = args.indexOf("--out")
const outBase = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join(root, "dist-app"))
const dest = path.join(outBase, "JCVC")
const app = path.join(dest, "app")
const say = (t) => console.log(`[package] ${t}`)
const run = (cmd, a, opts = {}) => {
  const r = spawnSync(cmd, a, {
    stdio: "inherit",
    shell: process.platform === "win32" && /\.cmd$|^npm$|^npx$/.test(cmd),
    ...opts,
  })
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(" ")} failed (${r.status})`)
}

if (process.platform !== "win32") throw new Error("JCVC.exe is built for Windows.")
const major = Number(process.versions.node.split(".")[0])
if (major < 22) throw new Error(`Node ${process.versions.node} is too old: JCVC needs 22 or newer.`)

if (!has("--skip-build") && !has("--exe-only")) {
  say("building the desktop interface and the phone app")
  run("npm", ["run", "build", "-w", "@gatehouse/web"], { cwd: root })
  run("npm", ["run", "build", "-w", "@gatehouse/phone"], { cwd: root })
}
for (const d of ["apps/web/dist/index.html", "apps/phone/dist/index.html"])
  if (!fs.existsSync(path.join(root, d)))
    throw new Error(`${d} is missing. Run without --skip-build.`)

const exeOnly = has("--exe-only")
if (!exeOnly) {
  say(`staging into ${dest}`)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(app, { recursive: true })

  const SKIP = new Set([
    "node_modules",
    "test",
    "coverage",
    ".claude",
    "dist-demo",
    "demo.html",
    "screens.html",
    ".turbo",
  ])
  const copy = (rel, { keepDist = false } = {}) => {
    const from = path.join(root, rel)
    if (!fs.existsSync(from)) return
    fs.cpSync(from, path.join(app, rel), {
      recursive: true,
      filter: (src) => {
        const name = path.basename(src)
        if (SKIP.has(name)) return false
        if (name === "dist" && !keepDist) return false
        if (
          /\.tsbuildinfo$/.test(name) ||
          /\.test\.tsx?$/.test(name) ||
          name === "rules.local.yaml"
        )
          return false
        return true
      },
    })
  }

  for (const f of ["package.json", "package-lock.json", "tsconfig.base.json"]) copy(f)
  for (const w of ["host", "approver", "companion", "relay"]) copy(`apps/${w}`)
  copy("apps/web", { keepDist: true })
  copy("apps/phone", { keepDist: true })
  for (const p of ["policy", "shared"]) copy(`packages/${p}`)
  copy("policy")
  for (const f of ["ps-ast.ps1", "dpapi.ps1", "verify-audit.ps1", "start.ps1", "links.mjs"])
    copy(`scripts/${f}`)
  for (const f of [
    "runbook.md",
    "relay-local.md",
    "threat-model.md",
    "policy-guide.md",
    "audit-format.md",
  ])
    copy(`docs/${f}`)
  copy("PRODUCT.md")
  copy("DESIGN.md")
  // The web and phone source is not needed to run: only what they built.
  for (const w of ["web", "phone"]) {
    for (const d of [
      "src",
      "public",
      "index.html",
      "vite.config.ts",
      "vite.sw.config.ts",
      "vite.demo.config.ts",
      "tsconfig.json",
    ])
      fs.rmSync(path.join(app, "apps", w, d), { recursive: true, force: true })
  }

  say("installing production dependencies (this needs the network the first time)")
  run(
    "npm",
    [
      "ci",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--workspace",
      "@gatehouse/host",
      "--workspace",
      "@gatehouse/approver",
      "--workspace",
      "@gatehouse/companion",
      "--workspace",
      "@gatehouse/relay",
      "--workspace",
      "@gatehouse/policy",
      "--workspace",
      "@gatehouse/shared",
    ],
    { cwd: app },
  )
  for (const must of [
    "tsx/dist/cli.mjs",
    "@anthropic-ai/claude-agent-sdk/package.json",
    "fastify/package.json",
    "web-tree-sitter/package.json",
  ])
    if (!fs.existsSync(path.join(app, "node_modules", must)))
      throw new Error(`node_modules/${must} was not installed`)

  // npm links the workspace packages into node_modules with junctions, which hold absolute paths. Record them as
  // relative pairs; scripts/links.mjs makes them point at wherever the folder is now, on every start.
  const scope = path.join(app, "node_modules", "@gatehouse")
  const links = fs
    .readdirSync(scope, { withFileTypes: true })
    .filter((e) => e.isSymbolicLink())
    .map((e) => ({
      link: path.relative(app, path.join(scope, e.name)).split(path.sep).join("/"),
      target: path
        .relative(app, fs.realpathSync(path.join(scope, e.name)))
        .split(path.sep)
        .join("/"),
    }))
  if (links.length === 0 || links.some((l) => l.target.startsWith("..")))
    throw new Error(`the workspace links in ${scope} are not what the package expects`)
  fs.writeFileSync(path.join(app, "workspace-links.json"), JSON.stringify(links, null, 2) + "\n")

  say("copying Node")
  fs.mkdirSync(path.join(dest, "runtime"), { recursive: true })
  fs.copyFileSync(process.execPath, path.join(dest, "runtime", "node.exe"))
  fs.writeFileSync(path.join(dest, "runtime", "NODE-VERSION.txt"), `${process.version}\n`)
}

say("compiling JCVC.exe")
const csc = [
  process.env.windir + "\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  process.env.windir + "\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
].find((p) => fs.existsSync(p))
if (!csc) throw new Error("The C# compiler that ships with Windows (csc.exe) was not found.")
// An .ico can hold a PNG, so the app icon is the phone's icon.
const png = fs.readFileSync(path.join(root, "apps/phone/public/icon-192.png"))
const ico = Buffer.alloc(22 + png.length)
ico.writeUInt16LE(0, 0)
ico.writeUInt16LE(1, 2)
ico.writeUInt16LE(1, 4)
ico[6] = 192
ico[7] = 192
ico.writeUInt16LE(1, 10)
ico.writeUInt16LE(32, 12)
ico.writeUInt32LE(png.length, 14)
ico.writeUInt32LE(22, 18)
png.copy(ico, 22)
const icoFile = path.join(outBase, "gatehouse.ico")
fs.writeFileSync(icoFile, ico)
// The window app uses Microsoft's WebView2 libraries, fetched once from NuGet and kept in dist-app/.cache.
const WV2 = "1.0.4314.35"
const cache = path.join(outBase, ".cache")
const wv2Dir = path.join(cache, "webview2-" + WV2)
if (!fs.existsSync(path.join(wv2Dir, "lib", "net462", "Microsoft.Web.WebView2.WinForms.dll"))) {
  say(`fetching the WebView2 libraries ${WV2}`)
  fs.mkdirSync(wv2Dir, { recursive: true })
  const nupkg = path.join(cache, `webview2-${WV2}.zip`)
  let bytes
  for (let i = 0; i < 4 && !bytes; i++) {
    try {
      const res = await fetch(
        `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WV2}/microsoft.web.webview2.${WV2}.nupkg`,
      )
      if (res.ok) bytes = Buffer.from(await res.arrayBuffer())
    } catch {
      /* try again */
    }
  }
  if (!bytes) throw new Error("Could not download the WebView2 libraries from nuget.org.")
  fs.writeFileSync(nupkg, bytes)
  run("pwsh", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath '${nupkg}' -DestinationPath '${wv2Dir}' -Force`,
  ])
}
const wv2Core = path.join(wv2Dir, "lib", "net462", "Microsoft.Web.WebView2.Core.dll")
const wv2Forms = path.join(wv2Dir, "lib", "net462", "Microsoft.Web.WebView2.WinForms.dll")
const wv2Loader = path.join(wv2Dir, "runtimes", "win-x64", "native", "WebView2Loader.dll")
for (const f of [wv2Core, wv2Forms, wv2Loader])
  if (!fs.existsSync(f)) throw new Error(`${f} is missing from the WebView2 package`)
const pk = (f) => path.join(root, "packaging", f)
// JCVC.exe: the window. JCVC-Console.exe: the same Host in a console, for troubleshooting and scripts.
execFileSync(
  csc,
  [
    "/nologo",
    "/target:winexe",
    "/optimize+",
    "/platform:x64",
    `/win32icon:${icoFile}`,
    `/win32manifest:${pk("JCVC.manifest")}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    `/r:${wv2Core}`,
    `/r:${wv2Forms}`,
    `/out:${path.join(dest, "JCVC.exe")}`,
    pk("JCVCApp.cs"),
    pk("Common.cs"),
  ],
  { stdio: "inherit" },
)
execFileSync(
  csc,
  [
    "/nologo",
    "/target:exe",
    "/optimize+",
    `/win32icon:${icoFile}`,
    `/out:${path.join(dest, "JCVC-Console.exe")}`,
    pk("Launcher.cs"),
    pk("Common.cs"),
  ],
  { stdio: "inherit" },
)
// JCVC-Update.exe: switches folders to a new version after JCVC closes, and goes back if it does not start.
execFileSync(
  csc,
  [
    "/nologo",
    "/target:winexe",
    "/optimize+",
    `/win32icon:${icoFile}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    `/out:${path.join(dest, "JCVC-Update.exe")}`,
    pk("Updater.cs"),
  ],
  { stdio: "inherit" },
)
for (const f of [wv2Core, wv2Forms, wv2Loader])
  fs.copyFileSync(f, path.join(dest, path.basename(f)))
// The start-up picture the window shows while the Host starts (the page shows it again once it loads).
fs.copyFileSync(
  path.join(root, "apps", "web", "public", "jcvc", "loading-trucks.png"),
  path.join(dest, "splash.png"),
)
fs.copyFileSync(path.join(wv2Dir, "LICENSE.txt"), path.join(dest, "WebView2-LICENSE.txt"))

fs.writeFileSync(
  path.join(dest, "README.txt"),
  [
    "Jean-Claude Van Code (JCVC)",
    "",
    "Double-click JCVC.exe. It opens the Jean-Claude Van Code window (not a browser tab).",
    "Closing the window keeps JCVC running in the tray so approvals still reach you. Quit from the tray icon.",
    "JCVC-Console.exe runs the same thing in a console window, for troubleshooting. --help lists the options.",
    "",
    "Keep the folder together: JCVC.exe finds runtime\\node.exe and the app folder next to it.",
    "You can move or copy the whole folder anywhere. Nothing is installed and nothing starts at logon.",
    "",
    "Your data (audit log, settings, usage) is in %LOCALAPPDATA%\\Gatehouse and stays when you replace this folder.",
    "Your policy rules are in app\\policy. When you replace the app folder with a newer one, copy your own",
    "rules.yaml, rules.local.yaml and rules.user.yaml across first (or keep the policy folder), or your changes are lost.",
    "",
    "Sign in to Claude Code on this computer first. On the first run, open Settings and set the organisation.",
    "Documents: app\\docs (runbook.md, relay-local.md, threat-model.md).",
    "",
  ].join("\r\n"),
)

// release.json: this folder's version and the hash of each part, so the updater knows what it has.
run(
  process.execPath,
  [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "scripts", "release.ts"),
    "stamp",
    dest,
  ],
  { cwd: root },
)

if (has("--zip")) {
  say("zipping")
  const zip = path.join(outBase, "JCVC.zip")
  fs.rmSync(zip, { force: true })
  run("pwsh", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${dest}' -DestinationPath '${zip}' -CompressionLevel Optimal`,
  ])
  say(`wrote ${zip}`)
}

const size = (() => {
  let n = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else n += fs.statSync(p).size
    }
  }
  walk(dest)
  return n
})()
say(`done: ${dest} (${Math.round(size / 1048576)} MB)`)

if (has("--check")) {
  say("checking the packaged copy")
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? ".", "gh-pkgcheck-"))
  const r = spawnSync(path.join(dest, "JCVC.exe"), ["--check"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      GATEHOUSE_DATA_DIR: dir,
      GATEHOUSE_AUDIT_DIR: path.join(dir, "audit"),
      GATEHOUSE_CONFIG: path.join(dir, "config.json"),
      GATEHOUSE_STATE: path.join(dir, "state.json"),
      GATEHOUSE_HOST_PORT: "0",
    },
    timeout: 300_000,
  })
  fs.rmSync(dir, { recursive: true, force: true })
  if (r.status !== 0) throw new Error(`the packaged JCVC.exe --check failed (${r.status})`)
  say("the packaged copy works")
}
