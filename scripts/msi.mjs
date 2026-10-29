// Makes dist-app\JCVC-Setup.msi from the packaged folder dist-app\JCVC, with nothing but Windows: the tables are
// written here as .idt text, the files go into a cabinet made by makecab.exe, and packaging/MsiBuild.cs puts them
// together with Windows Installer's own library (msi.dll).
//
// Usage: node scripts/msi.mjs [--check]
//   --check  afterwards install it for this user into a temporary folder, start it, and uninstall it again.
//
// The MSI is dual-purpose. Opened normally it installs for you alone in %LOCALAPPDATA%\Programs\JCVC (the same place
// as JCVC-Setup.exe), with no administrator prompt, and JCVC then updates itself as usual. An IT team can install it
// for everyone with ALLUSERS=1 (C:\Program Files\JCVC); JCVC cannot write there, so it says new versions come as a
// new MSI. Each version replaces the one before (one UpgradeCode, a ProductCode per version); an older MSI will not
// install over a newer one. It will not install over a copy installed with JCVC-Setup.exe, nor that over this.
import { execFileSync, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist-app", "JCVC")
const work = path.join(root, "dist-app", ".msi")
const out = path.join(root, "dist-app", "JCVC-Setup.msi")
const cache = path.join(root, "dist-app", ".cache")
const say = (t) => console.log(`[msi] ${t}`)

/** Never change: it is how Windows knows every JCVC MSI is the same product. */
const UPGRADE_CODE = "{825A9CA8-5364-4708-A0BC-8B8C13B501F9}"
/** JCVC-Setup.exe's own product id (packaging/installer.iss), to refuse installing over it. */
const INNO_KEY =
  "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{6C1E5B0A-2F1D-4F3B-9D6E-6B7A0C2E41A7}_is1"

if (!fs.existsSync(path.join(dist, "release.json"))) throw new Error("Run npm run package first.")
const release = JSON.parse(fs.readFileSync(path.join(dist, "release.json"), "utf8"))
// Windows Installer versions are numbers only: 1.0.72-dev is built as 1.0.72.
const version = /^(\d+)\.(\d+)\.(\d+)/.exec(release.version)?.slice(1, 4).join(".")
if (!version) throw new Error(`${release.version} is not a version Windows Installer can use`)

/** A GUID made from a name, so the same name always gives the same GUID (name-based, like UUID version 5). */
function guidFrom(name) {
  const b = crypto.createHash("sha1").update(`jcvc-msi:${name}`).digest().subarray(0, 16)
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString("hex").toUpperCase()
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`
}

// ---- what goes in: every file of the package, links left out (scripts/links.mjs makes them on first start) ----
const dirs = [""]
const files = []
const walk = (rel) => {
  for (const e of fs
    .readdirSync(path.join(dist, rel), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      dirs.push(r)
      walk(r)
    } else if (e.isFile()) files.push({ rel: r, size: fs.statSync(path.join(dist, r)).size })
  }
}
walk("")
// Brackets and braces mean something in Windows Installer's formatted text; % breaks makecab's list.
const odd = [...dirs, ...files.map((f) => f.rel)].filter((r) => /[^\x20-\x7e]|[%|\t[\]{}]/.test(r))
if (odd.length)
  throw new Error(
    `These names cannot go in an MSI (Windows Installer reads them in code page 1252):\n${odd.join("\n")}`,
  )
say(`version ${version}: ${files.length} files in ${dirs.length} folders`)

// ---- ids, short names and components ----
let counter = 0
const shortName = (name, isFile) => {
  const base = `J${(counter++).toString(36).toUpperCase().padStart(7, "0")}`
  const ext = isFile ? /\.([A-Za-z0-9]{1,3})$/.exec(name)?.[1] : undefined
  const s = ext ? `${base}.${ext.toUpperCase()}` : base
  return `${s}|${name}`
}
const dirId = new Map([["", "INSTALLDIR"]])
dirs.slice(1).forEach((d, i) => dirId.set(d, `D${i + 1}`))
const fileId = new Map(files.map((f, i) => [f.rel, `F${i + 1}`]))
const byDir = new Map()
for (const f of files) {
  const d = f.rel.includes("/") ? f.rel.slice(0, f.rel.lastIndexOf("/")) : ""
  if (!byDir.has(d)) byDir.set(d, [])
  byDir.get(d).push(f)
}
const compId = new Map([...byDir.keys()].map((d, i) => [d, `C${i + 1}`]))

// ---- tables ----
const tables = {}
function table(name, columns, keys, rows) {
  const bad = rows.flat().find((v) => typeof v === "string" && /[\t\r\n]/.test(v))
  if (bad !== undefined) throw new Error(`A value in ${name} has a tab or a line break: ${bad}`)
  tables[name] =
    [
      columns.map((c) => c[0]).join("\t"),
      columns.map((c) => c[1]).join("\t"),
      [name, ...keys].join("\t"),
      ...rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v))).join("\t")),
    ].join("\r\n") + "\r\n"
}

const productCode = guidFrom(`product:${version}`)
table(
  "Property",
  [
    ["Property", "s72"],
    ["Value", "l0"],
  ],
  ["Property"],
  [
    ["ProductCode", productCode],
    ["ProductName", "Jean-Claude Van Code"],
    ["ProductVersion", version],
    ["ProductLanguage", 1033],
    ["Manufacturer", "Jean-Claude Van Code"],
    ["UpgradeCode", UPGRADE_CODE],
    // Dual purpose: for you alone unless installed with ALLUSERS=1.
    ["ALLUSERS", 2],
    ["MSIINSTALLPERUSER", 1],
    ["ARPNOREPAIR", 1],
    ["ARPNOMODIFY", 1],
    ["ARPPRODUCTICON", "jcvc.ico"],
    ["ARPURLINFOABOUT", "https://github.com/breakmylegs/gatehouse"],
    ["ARPHELPLINK", "https://github.com/breakmylegs/gatehouse"],
    ["ARPCOMMENTS", "Run Claude agent sessions on Windows, and stay in charge of what they do."],
    ["DISABLEADVTSHORTCUTS", 1],
    ["SecureCustomProperties", "OLDERFOUND;NEWERFOUND;INNOINSTALLED"],
  ],
)

table(
  "Directory",
  [
    ["Directory", "s72"],
    ["Directory_Parent", "S72"],
    ["DefaultDir", "l255"],
  ],
  ["Directory"],
  [
    ["TARGETDIR", null, "SourceDir"],
    // Per user, Windows Installer points ProgramFiles64Folder at %LOCALAPPDATA%\Programs.
    ["ProgramFiles64Folder", "TARGETDIR", "."],
    ["ProgramMenuFolder", "TARGETDIR", "."],
    ["System64Folder", "TARGETDIR", "."],
    ["INSTALLDIR", "ProgramFiles64Folder", "JCVC"],
    ...dirs.slice(1).map((d) => {
      const parent = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : ""
      return [dirId.get(d), dirId.get(parent), shortName(path.posix.basename(d), false)]
    }),
  ],
)

const BIT64 = 256
table(
  "Component",
  [
    ["Component", "s72"],
    ["ComponentId", "S38"],
    ["Directory_", "s72"],
    ["Attributes", "i2"],
    ["Condition", "S255"],
    ["KeyPath", "S72"],
  ],
  ["Component"],
  [
    // The Start menu shortcut and the record that this copy came from the MSI. Its key is a registry value.
    ["CMain", guidFrom("component:main"), "INSTALLDIR", BIT64 + 4, null, "RegInstalled"],
    ...[...byDir.entries()].map(([d, fs_]) => [
      compId.get(d),
      guidFrom(`component:${d}`),
      dirId.get(d),
      BIT64,
      null,
      fileId.get(fs_[0].rel),
    ]),
  ],
)

table(
  "File",
  [
    ["File", "s72"],
    ["Component_", "s72"],
    ["FileName", "l255"],
    ["FileSize", "i4"],
    ["Version", "S72"],
    ["Language", "S20"],
    ["Attributes", "I2"],
    ["Sequence", "i2"],
  ],
  ["File"],
  files.map((f, i) => {
    const d = f.rel.includes("/") ? f.rel.slice(0, f.rel.lastIndexOf("/")) : ""
    return [
      fileId.get(f.rel),
      compId.get(d),
      shortName(path.posix.basename(f.rel), true),
      f.size,
      null,
      null,
      null,
      i + 1,
    ]
  }),
)

table(
  "Media",
  [
    ["DiskId", "i2"],
    ["LastSequence", "i2"],
    ["DiskPrompt", "L64"],
    ["Cabinet", "S255"],
    ["VolumeLabel", "S32"],
    ["Source", "S72"],
  ],
  ["DiskId"],
  [[1, files.length, null, "#jcvc.cab", null, null]],
)

table(
  "Feature",
  [
    ["Feature", "s38"],
    ["Feature_Parent", "S38"],
    ["Title", "L64"],
    ["Description", "L255"],
    ["Display", "I2"],
    ["Level", "i2"],
    ["Directory_", "S72"],
    ["Attributes", "i2"],
  ],
  ["Feature"],
  [
    [
      "Main",
      null,
      "Jean-Claude Van Code",
      "The JCVC window, its Host and its runtime.",
      0,
      1,
      "INSTALLDIR",
      8 + 16,
    ],
  ],
)

table(
  "FeatureComponents",
  [
    ["Feature_", "s38"],
    ["Component_", "s72"],
  ],
  ["Feature_", "Component_"],
  [["Main", "CMain"], ...[...compId.values()].map((c) => ["Main", c])],
)

table(
  "Registry",
  [
    ["Registry", "s72"],
    ["Root", "i2"],
    ["Key", "l255"],
    ["Name", "L255"],
    ["Value", "L0"],
    ["Component_", "s72"],
  ],
  ["Registry"],
  // Root -1: HKCU when installed for you, HKLM when installed for everyone. JCVC-Setup.exe reads it.
  [["RegInstalled", -1, "Software\\Gatehouse\\JCVC", "Installer", "msi", "CMain"]],
)

table(
  "Shortcut",
  [
    ["Shortcut", "s72"],
    ["Directory_", "s72"],
    ["Name", "l128"],
    ["Component_", "s72"],
    ["Target", "s72"],
    ["Arguments", "S255"],
    ["Description", "L255"],
    ["Hotkey", "I2"],
    ["Icon_", "S72"],
    ["IconIndex", "I2"],
    ["ShowCmd", "I2"],
    ["WkDir", "S72"],
  ],
  ["Shortcut"],
  [
    [
      "SJCVC",
      "ProgramMenuFolder",
      "JCVC|Jean-Claude Van Code",
      "CMain",
      "[INSTALLDIR]JCVC.exe",
      null,
      "Run Claude agent sessions and stay in charge of what they do",
      null,
      null,
      null,
      null,
      "INSTALLDIR",
    ],
  ],
)

table(
  "Icon",
  [
    ["Name", "s72"],
    ["Data", "v0"],
  ],
  ["Name"],
  [],
)

table(
  "Upgrade",
  [
    ["UpgradeCode", "s38"],
    ["VersionMin", "S20"],
    ["VersionMax", "S20"],
    ["Language", "S255"],
    ["Attributes", "i4"],
    ["Remove", "S255"],
    ["ActionProperty", "s72"],
  ],
  ["UpgradeCode", "VersionMin", "VersionMax", "Language", "Attributes"],
  [
    // Older versions are removed first (major upgrade).
    [UPGRADE_CODE, "0.0.1", version, null, 1 + 256, null, "OLDERFOUND"],
    // A newer one already installed stops this one.
    [UPGRADE_CODE, version, null, null, 2, null, "NEWERFOUND"],
  ],
)

table(
  "AppSearch",
  [
    ["Property", "s72"],
    ["Signature_", "s72"],
  ],
  ["Property", "Signature_"],
  [["INNOINSTALLED", "InnoInstall"]],
)
table(
  "RegLocator",
  [
    ["Signature_", "s72"],
    ["Root", "i2"],
    ["Key", "s255"],
    ["Name", "S255"],
    ["Type", "I2"],
  ],
  ["Signature_"],
  [["InnoInstall", 1, INNO_KEY, "InstallLocation", 2]],
)

table(
  "LaunchCondition",
  [
    ["Condition", "s255"],
    ["Description", "l255"],
  ],
  ["Condition"],
  [
    ["VersionNT64", "Jean-Claude Van Code needs 64-bit Windows."],
    ["NOT NEWERFOUND", "A newer version of Jean-Claude Van Code is already installed."],
    [
      "Installed OR NOT INNOINSTALLED",
      "Jean-Claude Van Code is already installed with JCVC-Setup.exe. It updates itself, so you do not need the MSI. To switch, uninstall it first from Windows Settings, Apps.",
    ],
  ],
)

// Custom actions, all plain commands. 34: run a command line from a folder. +1024 deferred, +64 carry on if it
// fails, +128 do not wait.
const CMD = '"[System64Folder]cmd.exe" /d /s /c'
table(
  "CustomAction",
  [
    ["Action", "s72"],
    ["Type", "i2"],
    ["Source", "S72"],
    ["Target", "S0"],
  ],
  ["Action"],
  [
    // Close a JCVC running from this folder, not any other copy, before its files are replaced or removed. Its job
    // object stops the Host with it.
    [
      "CloseJCVC",
      34 + 64,
      "System64Folder",
      '"[System64Folder]WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -Command "Get-Process JCVC,JCVC-Console -ErrorAction SilentlyContinue | Where-Object { $_.Path -like \'[INSTALLDIR]*\' } | Stop-Process -Force"',
    ],
    // Point npm's workspace links at this folder (as JCVC does on every start), so a copy installed for everyone,
    // which cannot change its own folder, still works.
    [
      "MakeLinks",
      34 + 1024 + 64,
      "INSTALLDIR",
      '"[INSTALLDIR]runtime\\node.exe" "[INSTALLDIR]app\\scripts\\links.mjs" "[INSTALLDIR]app"',
    ],
    // On uninstall, everything an update added that the MSI does not know about: the folder itself (only if it is a
    // JCVC folder), the version kept beside it, a half-built next version and leftovers of earlier switches.
    [
      "CleanUp",
      34 + 1024 + 64,
      "ProgramFiles64Folder",
      `${CMD} "(if exist "[INSTALLDIR]JCVC.exe" rd /s /q "[INSTALLDIR].") & (if exist "[INSTALLDIR]..\\JCVC.previous\\" rd /s /q "[INSTALLDIR]..\\JCVC.previous") & (if exist "[INSTALLDIR]..\\JCVC.next\\" rd /s /q "[INSTALLDIR]..\\JCVC.next") & (for /d %d in ("[INSTALLDIR]..\\JCVC.old-*" "[INSTALLDIR]..\\JCVC.failed-*") do rd /s /q "%d")"`,
    ],
    // Open JCVC when you installed it yourself with the normal window (not silently, not for everyone).
    ["StartJCVC", 34 + 64 + 128, "INSTALLDIR", '"[INSTALLDIR]JCVC.exe"'],
  ],
)

const seq = [
  ["Action", "s72"],
  ["Condition", "S255"],
  ["Sequence", "I2"],
]
table(
  "InstallExecuteSequence",
  seq,
  ["Action"],
  [
    ["FindRelatedProducts", null, 25],
    ["AppSearch", null, 50],
    ["LaunchConditions", null, 100],
    ["ValidateProductID", null, 700],
    ["CostInitialize", null, 800],
    ["FileCost", null, 900],
    ["CostFinalize", null, 1000],
    ["MigrateFeatureStates", null, 1200],
    ["CloseJCVC", 'REMOVE="ALL" OR OLDERFOUND', 1390],
    ["InstallValidate", null, 1400],
    ["RemoveExistingProducts", null, 1401],
    ["InstallInitialize", null, 1500],
    ["ProcessComponents", null, 1600],
    ["UnpublishFeatures", null, 1800],
    ["RemoveRegistryValues", null, 2600],
    ["RemoveShortcuts", null, 3200],
    ["CleanUp", 'REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE', 3490],
    ["RemoveFiles", null, 3500],
    ["InstallFiles", null, 4000],
    ["MakeLinks", 'NOT REMOVE="ALL"', 4010],
    ["CreateShortcuts", null, 4500],
    ["WriteRegistryValues", null, 5000],
    ["RegisterUser", null, 6000],
    ["RegisterProduct", null, 6100],
    ["PublishFeatures", null, 6300],
    ["PublishProduct", null, 6400],
    ["InstallFinalize", null, 6600],
    ["StartJCVC", 'NOT REMOVE="ALL" AND UILevel > 3 AND NOT ALLUSERS', 6700],
  ],
)
table(
  "InstallUISequence",
  seq,
  ["Action"],
  [
    ["FindRelatedProducts", null, 25],
    ["AppSearch", null, 50],
    ["LaunchConditions", null, 100],
    ["ValidateProductID", null, 700],
    ["CostInitialize", null, 800],
    ["FileCost", null, 900],
    ["CostFinalize", null, 1000],
    ["MigrateFeatureStates", null, 1200],
    ["ExecuteAction", null, 1300],
  ],
)

// ---- write it all ----
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
fs.writeFileSync(
  path.join(work, "_ForceCodepage.idt"),
  "\r\n\r\n1252\t_ForceCodepage\r\n",
  "latin1",
)
for (const [name, text] of Object.entries(tables))
  fs.writeFileSync(path.join(work, `${name}.idt`), text, "latin1")

say("compressing the files (makecab, a few minutes)")
const ddf = [
  ".OPTION EXPLICIT",
  ".Set CabinetNameTemplate=jcvc.cab",
  `.Set DiskDirectoryTemplate=${work}`,
  ".Set Cabinet=on",
  ".Set Compress=on",
  ".Set CompressionType=LZX",
  ".Set CompressionMemory=21",
  ".Set MaxDiskSize=0",
  ".Set CabinetFileCountThreshold=0",
  ".Set FolderFileCountThreshold=0",
  ".Set FolderSizeThreshold=0",
  ".Set MaxCabinetSize=0",
  ".Set UniqueFiles=on",
  `.Set RptFileName=${path.join(work, "cab.rpt")}`,
  `.Set InfFileName=${path.join(work, "cab.inf")}`,
  ...files.map((f) => `"${path.join(dist, ...f.rel.split("/"))}" ${fileId.get(f.rel)}`),
].join("\r\n")
fs.writeFileSync(path.join(work, "files.ddf"), ddf + "\r\n", "latin1")
const mc = spawnSync(
  path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "makecab.exe"),
  ["/F", path.join(work, "files.ddf")],
  {
    cwd: work,
    encoding: "latin1",
    maxBuffer: 256 * 1024 * 1024,
  },
)
if (mc.status !== 0) throw new Error(`makecab failed:\n${(mc.stdout + mc.stderr).slice(-3000)}`)

fs.copyFileSync(path.join(root, "dist-app", "gatehouse.ico"), path.join(work, "jcvc.ico"))
fs.writeFileSync(
  path.join(work, "streams.txt"),
  "_Streams\tjcvc.cab\tjcvc.cab\r\nIcon\tjcvc.ico\tjcvc.ico\r\n",
)
fs.writeFileSync(
  path.join(work, "summary.txt"),
  [
    [1, 1252],
    [2, "Installation Database"],
    [3, "Jean-Claude Van Code"],
    [4, "Jean-Claude Van Code"],
    [5, "Installer, MSI"],
    [6, `Installs Jean-Claude Van Code ${version}.`],
    [7, "x64;1033"],
    // A new package code every build, as Windows Installer requires.
    [9, `{${crypto.randomUUID().toUpperCase()}}`],
    [12, "now"],
    [13, "now"],
    [14, 500],
    // 2: files are compressed. 8: no administrator rights needed (for a per-user install).
    [15, 2 + 8],
    [18, "JCVC scripts/msi.mjs"],
    [19, 2],
  ]
    .map((r) => r.join("\t"))
    .join("\r\n") + "\r\n",
)

// MsiBuild.exe, compiled with the C# compiler that ships with Windows.
const csc = [
  `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
  `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
].find((p) => fs.existsSync(p))
if (!csc) throw new Error("The C# compiler that ships with Windows (csc.exe) was not found.")
const builder = path.join(cache, "MsiBuild.exe")
const source = path.join(root, "packaging", "MsiBuild.cs")
fs.mkdirSync(cache, { recursive: true })
if (!fs.existsSync(builder) || fs.statSync(builder).mtimeMs < fs.statSync(source).mtimeMs)
  execFileSync(csc, ["/nologo", "/target:exe", "/platform:x64", `/out:${builder}`, source], {
    stdio: "inherit",
  })
execFileSync(builder, [out, work], { stdio: "inherit" })
say(`wrote ${out} (${Math.round(fs.statSync(out).size / 1048576)} MB)`)

if (process.argv.includes("--check")) check()

/** Installs the MSI for this user into a temporary folder, checks what it did, starts it, and uninstalls it. */
function check() {
  const t = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "jcvc-msi-")))
  const dir = path.join(t, "JCVC")
  const msiexec = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "msiexec.exe")
  const problems = []
  const ok = (cond, what) => {
    say(`${cond ? "ok  " : "FAIL"} ${what}`)
    if (!cond) problems.push(what)
  }
  const shortcut = path.join(
    process.env.APPDATA ?? "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Jean-Claude Van Code.lnk",
  )
  const regInstalled = () =>
    spawnSync("reg", ["query", "HKCU\\Software\\Gatehouse\\JCVC", "/v", "Installer"], {
      encoding: "utf8",
    }).stdout.includes("msi")
  try {
    say(`installing for this user into ${dir}`)
    const inst = spawnSync(
      msiexec,
      ["/i", out, "/qn", `INSTALLDIR=${dir}\\`, "/l*v", path.join(t, "install.log")],
      { encoding: "utf8" },
    )
    ok(inst.status === 0, `msiexec installed it (exit ${inst.status})`)
    ok(
      fs.existsSync(path.join(dir, "JCVC.exe")) && fs.existsSync(path.join(dir, "JCVC-Update.exe")),
      "JCVC.exe and JCVC-Update.exe are there",
    )
    ok(
      JSON.parse(fs.readFileSync(path.join(dir, "release.json"), "utf8")).version ===
        release.version,
      `release.json says ${release.version}`,
    )
    const links = JSON.parse(fs.readFileSync(path.join(dir, "app", "workspace-links.json"), "utf8"))
    ok(
      links.every(
        (l) =>
          fs.realpathSync(path.join(dir, "app", l.link)).toLowerCase() ===
          path.join(dir, "app", l.target).toLowerCase(),
      ),
      "the install made the workspace links, pointing into the installed folder",
    )
    ok(fs.existsSync(shortcut), "the Start menu shortcut is there")
    ok(regInstalled(), "it recorded that it came from the MSI (JCVC-Setup.exe reads this)")
    const data = path.join(t, "data")
    const run = spawnSync(path.join(dir, "JCVC.exe"), ["--check"], {
      encoding: "utf8",
      timeout: 300_000,
      env: {
        ...process.env,
        GATEHOUSE_DATA_DIR: data,
        GATEHOUSE_AUDIT_DIR: path.join(data, "audit"),
        GATEHOUSE_CONFIG: path.join(data, "config.json"),
        GATEHOUSE_STATE: path.join(data, "state.json"),
        GATEHOUSE_HOST_PORT: "0",
      },
    })
    ok(run.status === 0, "the installed copy starts and passes JCVC.exe --check")
  } finally {
    say("uninstalling")
    const un = spawnSync(msiexec, ["/x", out, "/qn", "/l*v", path.join(t, "uninstall.log")], {
      encoding: "utf8",
    })
    ok(un.status === 0, `msiexec uninstalled it (exit ${un.status})`)
    ok(!fs.existsSync(dir), "the install folder is gone, including what the install made itself")
    ok(!fs.existsSync(shortcut), "the Start menu shortcut is gone")
    ok(!regInstalled(), "the MSI record is gone")
    if (problems.length === 0) fs.rmSync(t, { recursive: true, force: true })
    else say(`logs kept in ${t}`)
  }
  if (problems.length) {
    say(`FAILED: ${problems.length} check${problems.length === 1 ? "" : "s"}`)
    process.exit(1)
  }
  say("the MSI installs, runs and uninstalls")
}
