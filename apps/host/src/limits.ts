import { execFile, execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk"

/**
 * How much of this computer a session may use (owner, 30 Oct): Low, Medium or High, applied by JCVC-Limits.exe, which
 * runs the session's Claude Code inside a Windows job object with these caps. They cover everything it starts too,
 * shell commands included, so a build or test run counts against them.
 */
export type ResourceLevel = "low" | "medium" | "high"

export const LEVELS: Record<
  ResourceLevel,
  { cpu: number; memoryMb: number; priority: "below" | "normal" }
> = {
  // No caps: the session runs as it always has.
  high: { cpu: 0, memoryMb: 0, priority: "normal" },
  // Half the processor and 4 GB, and it gives way to what you are doing.
  medium: { cpu: 50, memoryMb: 4096, priority: "below" },
  // A fifth of the processor and 2 GB.
  low: { cpu: 20, memoryMb: 2048, priority: "below" },
}

const levelArgs = (l: ResourceLevel) => [
  "--cpu",
  String(LEVELS[l].cpu),
  "--memory-mb",
  String(LEVELS[l].memoryMb),
  "--priority",
  LEVELS[l].priority,
]

export interface Limiter {
  /** For the SDK's spawnClaudeCodeProcess: Claude Code inside its own job, at the session's level when it starts. */
  spawn(
    job: string,
    level: () => ResourceLevel,
    onStderr: (text: string) => void,
  ): (o: SpawnOptions) => SpawnedProcess
  /** Changes the level of a running session's job. */
  set(job: string, level: ResourceLevel): Promise<void>
}

/** The helper at `exe`. The SDK reads only stdin and stdout from a custom spawn, so stderr is passed on here. */
export function limiter(exe: string): Limiter {
  return {
    spawn: (job, level, onStderr) => (o) => {
      const child = spawn(exe, ["--name", job, ...levelArgs(level()), "--", o.command, ...o.args], {
        cwd: o.cwd,
        env: o.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        signal: o.signal,
      })
      child.stderr.on("data", (d: Buffer) => onStderr(d.toString("utf8")))
      return child as unknown as SpawnedProcess
    },
    set: (job, level) =>
      new Promise((resolve, reject) =>
        execFile(exe, ["--set", job, ...levelArgs(level)], { windowsHide: true }, (e, _out, err) =>
          e ? reject(new Error(String(err).trim() || e.message)) : resolve(),
        ),
      ),
  }
}

/**
 * The helper, or undefined where it cannot be had (not Windows, or no C# compiler for a source checkout). Packaged,
 * it sits next to JCVC.exe. From the source folder it is built once from packaging/Limits.cs into the data folder,
 * and again when the source is newer.
 */
export function findLimitsExe(o: {
  installDir: string | undefined
  repoRoot: string
  dataDir: string
  log: (line: string) => void
}): string | undefined {
  if (process.platform !== "win32") return undefined
  if (o.installDir) {
    const exe = path.join(o.installDir, "JCVC-Limits.exe")
    return fs.existsSync(exe) ? exe : undefined
  }
  const source = path.join(o.repoRoot, "packaging", "Limits.cs")
  const exe = path.join(o.dataDir, "bin", "JCVC-Limits.exe")
  try {
    if (fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= fs.statSync(source).mtimeMs) return exe
    const csc = [
      `${process.env.windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
      `${process.env.windir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`,
    ].find((p) => fs.existsSync(p))
    if (!csc) return undefined
    fs.mkdirSync(path.dirname(exe), { recursive: true })
    execFileSync(csc, ["/nologo", "/target:exe", "/optimize+", `/out:${exe}`, source], {
      windowsHide: true,
      stdio: "ignore",
    })
    return exe
  } catch (e) {
    o.log(
      `the resource limits helper could not be built (${(e as Error).message}), so sessions run without limits`,
    )
    return undefined
  }
}
