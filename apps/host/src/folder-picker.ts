import { spawn } from "node:child_process"
import fs from "node:fs"

/**
 * Opens the normal Windows "choose a folder" window and returns what was chosen, or undefined if the user
 * cancelled. It runs Windows PowerShell with a fixed script. The starting folder travels in an environment
 * variable, never inside the script text, so a folder name cannot become a command.
 */
const SCRIPT = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$f = New-Object System.Windows.Forms.Form",
  "$f.TopMost = $true; $f.ShowInTaskbar = $false; $f.StartPosition = 'Manual'",
  "$f.Location = New-Object System.Drawing.Point(-2000, -2000); $f.Size = New-Object System.Drawing.Size(1, 1)",
  "$f.Show()",
  "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$d.Description = 'Choose the project folder'; $d.ShowNewFolderButton = $true",
  "if ($env:CODEHOUSE_PICK_START -and (Test-Path -LiteralPath $env:CODEHOUSE_PICK_START -PathType Container)) { $d.SelectedPath = $env:CODEHOUSE_PICK_START }",
  "if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  "$f.Close()",
].join("; ")

export type FolderPicker = (start?: string) => Promise<string | undefined>

/** Where to save a copy: the normal Windows save window, suggesting a name. Undefined if you cancel. */
export type SaveAsPicker = (suggestedName: string) => Promise<string | undefined>

const SAVE_SCRIPT = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$f = New-Object System.Windows.Forms.Form",
  "$f.TopMost = $true; $f.ShowInTaskbar = $false; $f.StartPosition = 'Manual'",
  "$f.Location = New-Object System.Drawing.Point(-2000, -2000); $f.Size = New-Object System.Drawing.Size(1, 1)",
  "$f.Show()",
  "$d = New-Object System.Windows.Forms.SaveFileDialog; $d.Title = 'Save a copy'; $d.OverwritePrompt = $true",
  "$d.FileName = $env:CODEHOUSE_SAVE_NAME",
  "if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }",
  "$f.Close()",
].join("; ")

export const saveAsWithWindows: SaveAsPicker = (suggestedName) =>
  new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("Saving a copy in a window is only available on Windows."))
      return
    }
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-Command", SAVE_SCRIPT],
      {
        env: {
          ...process.env,
          CODEHOUSE_SAVE_NAME: suggestedName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 200),
        },
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    )
    const chunks: Buffer[] = []
    child.stdout.on("data", (c: Buffer) => chunks.push(c))
    child.on("error", reject)
    child.on("exit", () => {
      const picked = Buffer.concat(chunks).toString("utf8").trim()
      resolve(picked === "" ? undefined : picked)
    })
  })

export const pickFolderWithWindows: FolderPicker = (start) =>
  new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("Choosing a folder in a window is only available on Windows."))
      return
    }
    const startDir = start && fs.existsSync(start) && fs.statSync(start).isDirectory() ? start : ""
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-Command", SCRIPT],
      {
        env: { ...process.env, CODEHOUSE_PICK_START: startDir },
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    )
    const chunks: Buffer[] = []
    child.stdout.on("data", (c: Buffer) => chunks.push(c))
    child.on("error", reject)
    child.on("exit", () => {
      const picked = Buffer.concat(chunks).toString("utf8").trim()
      resolve(picked === "" ? undefined : picked)
    })
  })

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

/** The windows for this computer. */
export const pickFolder: FolderPicker =
  process.platform === "darwin" ? pickFolderWithMac : pickFolderWithWindows
export const saveAs: SaveAsPicker =
  process.platform === "darwin" ? saveAsWithMac : saveAsWithWindows
