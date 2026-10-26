import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadPolicy } from "../src/loader.js"
import type { LoadOptions } from "../src/loader.js"
import { PolicyEngine } from "../src/engine.js"
import { PwshWorker } from "../src/pwsh.js"
import { clearPathCaches } from "../src/paths.js"

const here = path.dirname(fileURLToPath(import.meta.url))
export const SEED_RULES = path.resolve(here, "../../../policy/rules.yaml")

export interface Fixture {
  /** Real path of the fixture root. */
  root: string
  /** The git workspace, a workspace root in the test policy. */
  ws: string
  /** A folder outside the workspace. */
  out: string
  /** Name of a workspace directory with a long name, and its 8.3 short name if one exists. */
  longDir: string
  shortDir: string | undefined
  dispose(): void
}

/** The 8.3 short name of a file or folder, or undefined when the volume has none for it. */
export function shortNameOf(p: string): string | undefined {
  try {
    const out = execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$p = $env:GH_SHORT_PATH; $fso = New-Object -ComObject Scripting.FileSystemObject; " +
          "if (Test-Path -LiteralPath $p -PathType Container) { $fso.GetFolder($p).ShortName } else { $fso.GetFile($p).ShortName }",
      ],
      { encoding: "utf8", env: { ...process.env, GH_SHORT_PATH: p } },
    ).trim()
    return out !== "" && out.toLowerCase() !== path.basename(p).toLowerCase() ? out : undefined
  } catch {
    return undefined
  }
}

function write(file: string, text = "x\n"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

/** Builds a throwaway workspace with secrets, a junction to the outside and a long directory name. */
export function makeFixture(): Fixture {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-fixture-")))
  const ws = path.join(root, "ws")
  const out = path.join(root, "out")
  fs.mkdirSync(path.join(ws, ".git"), { recursive: true })
  for (const f of [
    "src/a.ts",
    "test/a.test.ts",
    "docs/guide.md",
    "README.md",
    "package.json",
    "lib/util.js",
    ".env",
    ".env.local",
    "certs/server.pem",
    "certs/server.key",
    ".ssh/config",
    ".aws/credentials",
    "Long Directory Name/file.txt",
  ]) {
    write(path.join(ws, f))
  }
  write(path.join(out, "secret.txt"))
  write(path.join(out, ".env"))
  write(path.join(out, "notes.md"))
  try {
    fs.symlinkSync(out, path.join(ws, "link"), "junction")
  } catch {
    // reported by the tests that need it
  }
  const longDir = "Long Directory Name"
  const shortDir = shortNameOf(path.join(ws, longDir))
  return {
    root,
    ws,
    out,
    longDir,
    shortDir,
    dispose() {
      clearPathCaches()
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

export function fwd(p: string): string {
  return p.replace(/\\/g, "/")
}

export function testPolicy(fx: Fixture, extra: Partial<LoadOptions> = {}) {
  return loadPolicy({
    rulesPath: SEED_RULES,
    workspaceRootsOverride: [fwd(fx.ws)],
    ...extra,
  })
}

export function makeEngine(fx: Fixture, pwsh?: PwshWorker, extra: Partial<LoadOptions> = {}) {
  const policy = testPolicy(fx, extra)
  return { engine: new PolicyEngine({ getPolicy: () => policy, pwsh }), policy }
}
