import { spawn } from "node:child_process"
import fs from "node:fs"
import type { FolderPicker, SaveAsPicker } from "./folder-picker.js"

// Mac fork: the folder and save windows on a Mac. Kept out of folder-picker.ts so upstream's changes to the
// Windows windows merge without conflicts; bootstrap.ts chooses these on a Mac (see docs/mac.md).

/**
 * The Mac windows, through osascript. As on Windows the script is fixed: the starting folder and the suggested name
 * are arguments to its run handler, never part of its text, so neither can become a command. Cancel is error -128,
 * which the script turns into no answer.
 */
const MAC_FOLDER_SCRIPT = [
  "on run argv",
  "activate",
  "try",
  "if (count of argv) > 0 then",
  'set f to choose folder with prompt "Choose the project folder" default location (POSIX file (item 1 of argv))',
  "else",
  'set f to choose folder with prompt "Choose the project folder"',
  "end if",
  "return POSIX path of f",
  "on error number -128",
  'return ""',
  "end try",
  "end run",
]

const MAC_SAVE_SCRIPT = [
  "on run argv",
  "activate",
  "try",
  'return POSIX path of (choose file name with prompt "Save a copy" default name (item 1 of argv))',
  "on error number -128",
  'return ""',
  "end try",
  "end run",
]

const script = (lines: string[]) => lines.flatMap((l) => ["-e", l])

/** osascript's arguments for the folder window. Only an absolute folder that is there is passed on. */
export function macFolderArgs(start?: string): string[] {
  const ok =
    start !== undefined &&
    start.startsWith("/") &&
    fs.existsSync(start) &&
    fs.statSync(start).isDirectory()
  return [...script(MAC_FOLDER_SCRIPT), ...(ok ? [start] : [])]
}

/**
 * osascript's arguments for the save window. The name loses the characters a Mac file name cannot have, and a
 * leading dash or dot, so osascript never reads it as an option and the copy is not hidden.
 */
export function macSaveArgs(suggestedName: string): string[] {
  const name =
    suggestedName
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/^[-.]+/, "_")
      .slice(0, 200) || "copy"
  return [...script(MAC_SAVE_SCRIPT), name]
}

/** What osascript printed, without the newline, and a folder without its trailing slash. */
export function macPicked(out: string): string | undefined {
  const p = out.trim()
  if (p === "") return undefined
  return p.length > 1 ? p.replace(/\/+$/, "") : p
}

function runOsascript(args: string[]): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/osascript", args, { stdio: ["ignore", "pipe", "ignore"] })
    const chunks: Buffer[] = []
    child.stdout.on("data", (c: Buffer) => chunks.push(c))
    child.on("error", reject)
    child.on("exit", () => resolve(macPicked(Buffer.concat(chunks).toString("utf8"))))
  })
}

export const pickFolderWithMac: FolderPicker = (start) => runOsascript(macFolderArgs(start))
export const saveAsWithMac: SaveAsPicker = (suggestedName) =>
  runOsascript(macSaveArgs(suggestedName))
