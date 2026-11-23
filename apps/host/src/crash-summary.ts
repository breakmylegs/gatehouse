/**
 * E-045, a crash summary (Expansion E4). What a crash leaves behind, read into a short summary with its top frames mapped
 * to source (E-039's mapper, maps inside the project only): a Node diagnostic report (report.*.json, written by
 * --report-on-fatalerror or --report-uncaught-exception), a .NET "Unhandled exception." block, and a Windows crash code
 * in an exit message (described as Codehouse's own crash notes describe them). A command can be run once as a Codehouse
 * action with Node's report flags on, so a crash leaves a report; reports only write files, nothing listens. dotnet-dump
 * reads a .NET dump only when it is on this computer.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describeStop } from "./crash.js"
import { mapFrame, parseFrame, type Frame } from "./error-triage.js"

export interface CrashSummary {
  kind: "node-report" | "dotnet" | "windows-code"
  /** What happened, in a line. */
  what: string
  /** The error's message, when there is one. */
  message?: string
  frames: Frame[]
  /** Where it came from: the report file, or "log". */
  from: string
  at?: string
}

/** A Node diagnostic report read into a summary; undefined when it is not one. */
export function readNodeReport(root: string, json: unknown, from: string): CrashSummary | undefined {
  const r = json as { header?: { event?: string; trigger?: string; dumpEventTime?: string }; javascriptStack?: { message?: string; stack?: string[] }; nativeStack?: Array<{ symbol?: string }> }
  if (!r?.header?.event) return undefined
  const frames = (r.javascriptStack?.stack ?? []).map((l) => parseFrame(l)).filter((f): f is Frame => !!f).slice(0, 10).map((f) => mapFrame(root, f))
  const message = r.javascriptStack?.message
  return {
    kind: "node-report",
    what: `Node stopped: ${r.header.event}${r.header.trigger ? ` (${r.header.trigger})` : ""}`,
    ...(message && message !== "No stack." ? { message: message.slice(0, 500) } : {}),
    frames: frames.length ? frames : (r.nativeStack ?? []).slice(0, 5).map((n) => ({ fn: String(n.symbol ?? "?"), file: "(native)", line: 0 })),
    from,
    ...(r.header.dumpEventTime ? { at: r.header.dumpEventTime } : {}),
  }
}

/** The .NET unhandled exceptions in some output, each with its frames. */
export function readDotnetCrashes(root: string, text: string, from: string): CrashSummary[] {
  const out: CrashSummary[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*Unhandled exception\.\s+([\w.]+(?:Exception|Error))(?::\s*(.*))?$/.exec(lines[i]!)
    if (!m) continue
    const frames: Frame[] = []
    for (let j = i + 1; j < lines.length && frames.length < 10; j++) {
      const f = parseFrame(lines[j]!)
      if (!f) {
        if (/^\s*at\s/.test(lines[j]!)) continue
        break
      }
      frames.push(mapFrame(root, f))
    }
    out.push({ kind: "dotnet", what: `.NET stopped on an unhandled ${m[1]}`, ...(m[2] ? { message: m[2].slice(0, 500) } : {}), frames, from })
  }
  return out
}

/** The Windows crash codes in some output, each described. */
export function readCrashCodes(text: string, from: string): CrashSummary[] {
  const out: CrashSummary[] = []
  const seen = new Set<number>()
  for (const m of text.matchAll(/(?:exited with code|exit code)\s+(-?\d+|0x[0-9a-f]+)/gi)) {
    const raw = m[1]!.startsWith("0x") ? parseInt(m[1]!, 16) : Number(m[1])
    const code = raw < 0 ? raw >>> 0 : raw
    if (code < 0xc0000000 || seen.has(code)) continue
    seen.add(code)
    out.push({ kind: "windows-code", what: describeStop(`process exited with code ${code}`), frames: [], from })
  }
  return out
}

/** Node reports in a folder, newest first, written in the last week. */
export function reportFiles(dir: string, now = Date.now()): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^report\.[\d.]+\.json$/.test(f))
      .map((f) => path.join(dir, f))
      .filter((p) => now - fs.statSync(p).mtimeMs < 7 * 86_400_000)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, 10)
  } catch {
    return []
  }
}

/** Every crash the project left: its reports, and .NET crashes and crash codes in its log lines. */
export function summariseCrashes(root: string, logText: string): CrashSummary[] {
  const reports = reportFiles(root).flatMap((p) => {
    try {
      const s = readNodeReport(root, JSON.parse(fs.readFileSync(p, "utf8")), path.basename(p))
      return s ? [s] : []
    } catch {
      return []
    }
  })
  return [...reports, ...readDotnetCrashes(root, logText, "log"), ...readCrashCodes(logText, "log")]
}

/** NODE_OPTIONS for a run that leaves a report when it crashes; inspector flags taken out, nothing listens. */
export function crashReportOptions(existing: string | undefined, dir: string): string {
  const kept = (existing ?? "").split(/\s+/).filter((f) => f && !/^--(inspect|inspect-brk|inspect-port|debug|debug-brk|report-\w+)(=|$)/.test(f))
  return [...kept, "--report-on-fatalerror", "--report-uncaught-exception", `--report-directory=${JSON.stringify(dir)}`].join(" ")
}

export type CrashRun = (command: string, cwd: string, env: Record<string, string>) => Promise<{ ran: boolean; exitCode: number | null; output: string; refused?: string }>

/** Runs a command once with crash reports on, and summarises how it ended; the report folder is deleted afterwards. */
export async function runWithCrashReports(root: string, command: string, run: CrashRun, env: NodeJS.ProcessEnv = process.env): Promise<{ exitCode: number | null; crashes: CrashSummary[] } | { notRun: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-crash-"))
  try {
    const r = await run(command, root, { NODE_OPTIONS: crashReportOptions(env.NODE_OPTIONS, dir) })
    if (!r.ran) return { notRun: r.refused ?? "refused" }
    const crashes = [...reportFiles(dir).flatMap((p) => {
      try {
        const s = readNodeReport(root, JSON.parse(fs.readFileSync(p, "utf8")), "this run")
        return s ? [s] : []
      } catch {
        return []
      }
    }), ...readDotnetCrashes(root, r.output, "this run"), ...readCrashCodes(`exited with code ${r.exitCode ?? 0}\n${r.output}`, "this run")]
    return { exitCode: r.exitCode, crashes }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** The dotnet-dump command that prints every managed thread's stack from a dump. */
export const dotnetDumpCommand = (dump: string) => `dotnet-dump analyze ${JSON.stringify(dump)} -c "clrstack -all" -c exit`

/** A summary in words, for the panel and for Claude. */
export function crashText(s: CrashSummary): string {
  const where = s.frames.slice(0, 5).map((f) => (f.source ? `${f.source.file}:${f.source.line}` : `${f.file}:${f.line}`) + (f.fn ? ` (${f.fn})` : "")).join("\n  ")
  return [s.what, s.message ?? "", where ? `Top frames:\n  ${where}` : ""].filter(Boolean).join("\n")
}
