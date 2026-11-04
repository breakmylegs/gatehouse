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

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 200)
const folderOrEmpty = (start?: string) =>
  start && fs.existsSync(start) && fs.statSync(start).isDirectory() ? start : ""

/** What a window program printed: the path chosen, or undefined when you cancelled. */
function chosen(
  exe: string,
  args: string[],
  env: Record<string, string>,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    child.stdout.on("data", (c: Buffer) => chunks.push(c))
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`the window could not be opened (exit ${code ?? "unknown"})`))
        return
      }
      const picked = Buffer.concat(chunks).toString("utf8").trim()
      resolve(picked === "" ? undefined : picked)
    })
  })
}

/**
 * The same two windows through Codehouse-Helper.exe (packaging/Helper.cs), with no PowerShell (owner, 4 Nov: "Why do
 * I need powershell at all?"). The PowerShell ones below are the fallback where the helper cannot be had.
 */
export function helperPickers(exe: string): { pickFolder: FolderPicker; saveAs: SaveAsPicker } {
  return {
    pickFolder: (start) =>
      chosen(exe, ["--pick-folder"], { CODEHOUSE_PICK_START: folderOrEmpty(start) }),
    saveAs: (suggestedName) =>
      chosen(exe, ["--save-as"], { CODEHOUSE_SAVE_NAME: safeName(suggestedName) }),
  }
}

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
