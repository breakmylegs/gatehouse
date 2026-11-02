<#
.SYNOPSIS
  Starts Gatehouse: the Host (which starts the Approver) and opens the interface in your browser.

.DESCRIPTION
  Builds the interface first if it has not been built. Prints the one-time address (it ends in #token=...)
  and opens it. Stop with Ctrl+C. Nothing here starts at logon: see docs/runbook.md if you want that.

.PARAMETER NoBrowser
  Do not open the browser.

.PARAMETER Relay
  Also start the phone Relay on this computer (see docs/relay-local.md). It needs its public address given once.

.PARAMETER Check
  Start, confirm the Host answers with its token, then stop and exit 0 (or 1). For testing the script.

.PARAMETER TimeoutSeconds
  How long to wait for the Host to say it is ready. The first start can take a minute.
#>
[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$Relay,
  [switch]$Check,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say([string]$text) { Write-Host "[gatehouse] $text" }

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { Say 'Node is not installed or not on PATH. Install Node 22 or newer and try again.'; exit 1 }
$major = [int](& node -p 'process.versions.node.split(".")[0]')
if ($major -lt 22) { Say "Node $major is too old. Gatehouse needs Node 22 or newer."; exit 1 }
if (-not (Test-Path (Join-Path $root 'node_modules'))) { Say 'Dependencies are missing. Run: npm ci'; exit 1 }

if (-not (Test-Path (Join-Path $root 'apps/web/dist/index.html'))) {
  Say 'Building the interface (first start only)...'
  & npm run build -w '@gatehouse/web' | Out-Null
  if ($LASTEXITCODE -ne 0) { Say 'The interface did not build. Run: npm run build -w @gatehouse/web'; exit 1 }
}

# One process object per child, with its output read as it arrives.
function Start-Child([string]$name, [string[]]$arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node.Source
  foreach ($a in $arguments) { $psi.ArgumentList.Add($a) }
  $psi.WorkingDirectory = $root
  $psi.Environment['GATEHOUSE_EXIT_ON_STDIN_CLOSE'] = '1'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $null = $p.Start()
  return $p
}

$children = @()
$ready = $null
try {
  $tsx = Join-Path $root 'node_modules/tsx/dist/cli.mjs'
  $host_ = Start-Child 'host' @($tsx, 'apps/host/src/main.ts')
  $children += $host_
  $stdout = $host_.StandardOutput
  $stderr = $host_.StandardError
  $errTask = $stderr.ReadLineAsync()
  $outTask = $stdout.ReadLineAsync()
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (-not $ready) {
    if ($host_.HasExited -and $outTask.IsCompleted -eq $false -and $errTask.IsCompleted -eq $false) { break }
    if ((Get-Date) -gt $deadline) { Say "The Host did not become ready in $TimeoutSeconds seconds."; exit 1 }
    if ($errTask.IsCompleted) {
      if ($errTask.Result) { Write-Host $errTask.Result }
      $errTask = $stderr.ReadLineAsync()
    }
    if ($outTask.IsCompleted) {
      $line = $outTask.Result
      if ($null -eq $line) { break }
      try {
        $j = $line | ConvertFrom-Json -ErrorAction Stop
        if ($j.event -eq 'ready') { $ready = $j }
      } catch { Write-Host $line }
      $outTask = $stdout.ReadLineAsync()
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $ready) { Say 'The Host stopped before it was ready. The messages above say why.'; exit 1 }

  Say "Ready on port $($ready.port)."
  Say "Open: $($ready.url)"
  Say 'The part after #token= is private to this run. Do not share it.'

  if ($Relay) {
    Say 'Starting the Relay (see docs/relay-local.md for the first-run address)...'
    $children += Start-Child 'relay' @($tsx, 'apps/relay/src/main.ts')
  }

  if ($Check) {
    $base = "http://127.0.0.1:$($ready.port)"
    $token = ($ready.url -split '#token=')[1]
    $state = Invoke-RestMethod -Uri "$base/api/state" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 15
    $denied = $false
    try { Invoke-RestMethod -Uri "$base/api/state" -TimeoutSec 15 | Out-Null } catch { $denied = $true }
    if ($state.type -eq 'hello' -and $denied) { Say 'Check passed: the Host answers with its token and refuses without it.'; exit 0 }
    Say 'Check failed.'
    exit 1
  }

  if (-not $NoBrowser) {
    $edge = Get-Command msedge -ErrorAction SilentlyContinue
    if ($edge) { Start-Process $edge.Source -ArgumentList $ready.url } else { Start-Process $ready.url }
  }

  Say 'Running. Press Ctrl+C to stop.'
  while (-not $host_.HasExited) {
    if ($errTask.IsCompleted) { if ($errTask.Result) { Write-Host $errTask.Result }; $errTask = $stderr.ReadLineAsync() }
    if ($outTask.IsCompleted) { if ($null -ne $outTask.Result) { Write-Host $outTask.Result }; $outTask = $stdout.ReadLineAsync() }
    Start-Sleep -Milliseconds 200
  }
  Say "The Host stopped (exit code $($host_.ExitCode))."
  exit $host_.ExitCode
}
finally {
  # Closing a child's input tells it to stop cleanly. Whatever is still running after a few seconds is ended.
  foreach ($c in $children) {
    try { $c.StandardInput.Close() } catch { }
  }
  foreach ($c in $children) {
    try {
      if (-not $c.HasExited) { $null = $c.WaitForExit(4000) }
      if (-not $c.HasExited) { $c.Kill($true) }
    } catch { }
  }
}
