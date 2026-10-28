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
  "if ($env:JCVC_PICK_START -and (Test-Path -LiteralPath $env:JCVC_PICK_START -PathType Container)) { $d.SelectedPath = $env:JCVC_PICK_START }",
  "if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  "$f.Close()",
].join("; ")

export type FolderPicker = (start?: string) => Promise<string | undefined>

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
        env: { ...process.env, JCVC_PICK_START: startDir },
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
