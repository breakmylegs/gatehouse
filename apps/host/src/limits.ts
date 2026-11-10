import { execFile, spawn, type ChildProcess } from "node:child_process"
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk"
import type { ResourceLevel } from "@gatehouse/shared/ws-protocol"
import { findWindowsHelper, type HelperPlace } from "./win-helper.js"

/**
 * How much of this computer a session may use (owner, 30 Oct): Low, Medium or High, applied by Codehouse-Limits.exe, which
 * runs the session's Claude Code inside a Windows job object with these caps. They cover everything it starts too,
 * shell commands included, so a build or test run counts against them.
 */
export type { ResourceLevel }

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
  // A tenth of the processor and 1 GB, for work left to run in the background.
  lowest: { cpu: 10, memoryMb: 1024, priority: "below" },
  // Three quarters of the processor and 8 GB, at the usual priority.
  higher: { cpu: 75, memoryMb: 8192, priority: "normal" },
}

const levelArgs = (l: ResourceLevel) => [
  "--cpu",
  String(LEVELS[l].cpu),
  "--memory-mb",
  String(LEVELS[l].memoryMb),
  "--priority",
  LEVELS[l].priority,
]

/** What a session's job uses now: its share of the whole processor, the memory of its processes, how many there are. */
export interface JobUsage {
  cpu: number
  memoryMb: number
  processes: number
}

/** How often the helper says what the job uses, in seconds. */
export const REPORT_SECONDS = 5
const USAGE = "[codeh-usage] "

/** A usage line from the helper, or undefined for anything else (or a line it cannot read). */
export function usageOf(line: string): JobUsage | undefined {
  if (!line.startsWith(USAGE)) return undefined
  try {
    const o = JSON.parse(line.slice(USAGE.length)) as Record<string, unknown>
    const n = (v: unknown, max: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : undefined
    const cpu = n(o.cpu, 100)
    const memoryMb = n(o.memoryMb, 1 << 30)
    const processes = n(o.processes, 1 << 20)
    return cpu === undefined || memoryMb === undefined || processes === undefined
      ? undefined
      : { cpu, memoryMb, processes }
  } catch {
    return undefined
  }
}

/**
 * Splits the helper's error stream into lines: usage lines go to onUsage, the rest on to onStderr as they came. A line
 * cut between two chunks is kept until the rest arrives.
 */
export function splitStderr(
  onStderr: (text: string) => void,
  onUsage?: (u: JobUsage) => void,
): (chunk: string) => void {
  let rest = ""
  return (chunk) => {
    const lines = (rest + chunk).split(/\r?\n/)
    rest = lines.pop() ?? ""
    // A piece with no line end yet is held only while it could still be a usage line; anything else goes on now.
    if (rest && !USAGE.startsWith(rest) && !rest.startsWith(USAGE)) {
      onStderr(
        lines
          .filter((l) => !usageOf(l))
          .map((l) => l + "\n")
          .join("") + rest,
      )
      for (const l of lines) {
        const u = usageOf(l)
        if (u) onUsage?.(u)
      }
      rest = ""
      return
    }
    let other = ""
    for (const line of lines) {
      const u = usageOf(line)
      if (u) onUsage?.(u)
      else other += line + "\n"
    }
    if (other) onStderr(other)
  }
}

export interface Limiter {
  /** For the SDK's spawnClaudeCodeProcess: Claude Code inside its own job, at the session's level when it starts. */
  spawn(
    job: string,
    level: () => ResourceLevel,
    onStderr: (text: string) => void,
    /** What the job uses, every few seconds. */
    onUsage?: (u: JobUsage) => void,
  ): (o: SpawnOptions) => SpawnedProcess
  /** Changes the level of a running session's job. */
  set(job: string, level: ResourceLevel): Promise<void>
}

/** The helper at `exe`. The SDK reads only stdin and stdout from a custom spawn, so stderr is passed on here. */
export function limiter(exe: string): Limiter {
  return {
    spawn: (job, level, onStderr, onUsage) => (o) => {
      const args = ["--name", job, ...levelArgs(level()), "--report", String(REPORT_SECONDS)]
      const child = spawn(exe, [...args, "--", o.command, ...o.args], {
        cwd: o.cwd,
        env: o.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        signal: o.signal,
      })
      const pass = splitStderr(onStderr, onUsage)
      child.stderr.on("data", (d: Buffer) => pass(d.toString("utf8")))
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
 * D-002: a command line run through cmd.exe inside its own job at the Medium level, so a held-out run cannot take the
 * whole computer, and ends with everything it started.
 */
export function limitedCommand(exe: string, job: string, command: string, cwd: string): ChildProcess {
  return spawn(exe, ["--name", job, ...levelArgs("medium"), "--", "cmd.exe", "/d", "/s", "/c", command], {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

/** Codehouse-Limits.exe (packaging/Limits.cs), found or built as every helper is (win-helper.ts). */
export function findLimitsExe(o: HelperPlace): string | undefined {
  return findWindowsHelper({
    ...o,
    exe: "Codehouse-Limits.exe",
    source: "Limits.cs",
    cscArgs: ["/target:exe"],
    what: "the resource limits helper, so sessions run without limits,",
  })
}
