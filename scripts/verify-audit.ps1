# Verifies the Gatehouse audit log without Node: an independent implementation of the check in
# packages/shared/src/audit/verify.ts. It recomputes every record's SHA-256 from its own canonical
# JSON, so a bug in one verifier does not hide a problem from the other.
#
#   .\scripts\verify-audit.ps1 [-Dir <folder>] [-Json]
#
# Exit code 0: the chain is intact. 1: problems found. Needs PowerShell 7.5 or later.
param(
    [string]$Dir = $(if ($env:GATEHOUSE_AUDIT_DIR) { $env:GATEHOUSE_AUDIT_DIR } elseif ($env:GATEHOUSE_DATA_DIR) { Join-Path $env:GATEHOUSE_DATA_DIR 'audit' } else { Join-Path $env:LOCALAPPDATA 'Gatehouse\audit' }),
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$genesis = '0' * 64
$problems = New-Object System.Collections.ArrayList

function Add-Problem([string]$file, [int]$line, $seq, [string]$reason) {
    $p = [ordered]@{ file = $file; line = $line; reason = $reason }
    if ($null -ne $seq) { $p['seq'] = [long]$seq }
    [void]$problems.Add($p)
}

# JSON string escaping exactly as JSON.stringify does it: only quote, backslash and control characters.
function ConvertTo-CanonicalString([string]$s) {
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append('"')
    foreach ($ch in $s.ToCharArray()) {
        $code = [int]$ch
        switch ($code) {
            34 { [void]$sb.Append('\"') }
            92 { [void]$sb.Append('\\') }
            8 { [void]$sb.Append('\b') }
            12 { [void]$sb.Append('\f') }
            10 { [void]$sb.Append('\n') }
            13 { [void]$sb.Append('\r') }
            9 { [void]$sb.Append('\t') }
            default {
                if ($code -lt 32) { [void]$sb.Append(('\u{0:x4}' -f $code)) } else { [void]$sb.Append($ch) }
            }
        }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

# Canonical JSON (RFC 8785 style): keys sorted by UTF-16 code unit, no whitespace. Records hold only
# strings, integers, booleans, arrays and objects, which is why this can be so small.
function ConvertTo-Canonical($v) {
    if ($null -eq $v) { return 'null' }
    if ($v -is [bool]) { if ($v) { return 'true' } else { return 'false' } }
    if ($v -is [string]) { return ConvertTo-CanonicalString $v }
    if ($v -is [int] -or $v -is [long]) { return ([long]$v).ToString([System.Globalization.CultureInfo]::InvariantCulture) }
    if ($v -is [double]) {
        if ($v -eq [math]::Floor($v) -and [math]::Abs($v) -lt 9007199254740992) { return ([long]$v).ToString([System.Globalization.CultureInfo]::InvariantCulture) }
        throw 'non-integer number in an audit record'
    }
    if ($v -is [System.Collections.IDictionary]) {
        $keys = [string[]]@($v.Keys)
        [Array]::Sort($keys, [System.StringComparer]::Ordinal)
        $parts = foreach ($k in $keys) { (ConvertTo-CanonicalString $k) + ':' + (ConvertTo-Canonical $v[$k]) }
        return '{' + ($parts -join ',') + '}'
    }
    if ($v -is [System.Collections.IEnumerable]) {
        $parts = foreach ($x in $v) { ConvertTo-Canonical $x }
        return '[' + (@($parts) -join ',') + ']'
    }
    throw "cannot canonicalise a value of type $($v.GetType().Name)"
}

function Get-Sha256Hex([string]$text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Test-IsInteger($v) { return ($v -is [int] -or $v -is [long]) }
function Test-Hex64($v) { return ($v -is [string] -and $v -match '^[0-9a-f]{64}$') }

# Mirrors the AuditRecord schema closely enough to reject a record the Node verifier would reject.
function Test-RecordShape($r) {
    if ($r -isnot [System.Collections.IDictionary]) { return $false }
    if (-not ($r.ContainsKey('v') -and (Test-IsInteger $r['v']) -and $r['v'] -eq 1)) { return $false }
    if (-not ($r.ContainsKey('seq') -and (Test-IsInteger $r['seq']) -and $r['seq'] -ge 1)) { return $false }
    foreach ($k in 'ts', 'session', 'event', 'tool', 'inputJson') {
        if (-not ($r.ContainsKey($k) -and $r[$k] -is [string])) { return $false }
    }
    if (-not ($r.ContainsKey('channel') -and $r['channel'] -in @('approver', 'host', 'desktop', 'phone', 'timeout'))) { return $false }
    if (-not ($r.ContainsKey('latencyMs') -and (Test-IsInteger $r['latencyMs']) -and $r['latencyMs'] -ge 0)) { return $false }
    if (-not ($r.ContainsKey('prevHash') -and (Test-Hex64 $r['prevHash']))) { return $false }
    if (-not ($r.ContainsKey('hash') -and (Test-Hex64 $r['hash']))) { return $false }
    $vd = $r['verdict']
    if ($vd -isnot [System.Collections.IDictionary]) { return $false }
    if (-not ($vd.ContainsKey('outcome') -and $vd['outcome'] -in @('allow', 'deny', 'escalate'))) { return $false }
    foreach ($k in 'ruleId', 'reason', 'policyHash') { if (-not ($vd.ContainsKey($k) -and $vd[$k] -is [string])) { return $false } }
    if (-not ($vd.ContainsKey('risk') -and (Test-IsInteger $vd['risk']) -and $vd['risk'] -ge 0 -and $vd['risk'] -le 100)) { return $false }
    if (-not ($vd.ContainsKey('decidedBy') -and $vd['decidedBy'] -in @('floor', 'rules', 'judge', 'human-desktop', 'human-phone', 'timeout', 'evaluator-unavailable'))) { return $false }
    return $true
}

$prevSeq = [long]0
$prevHash = $genesis
$records = 0
$files = @()
if (Test-Path -LiteralPath $Dir) {
    $files = @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Name -match '^audit-\d{4}-\d{2}\.jsonl$' } | ForEach-Object { $_.Name })
    [Array]::Sort($files, [System.StringComparer]::Ordinal)
}

foreach ($file in $files) {
    $text = [System.IO.File]::ReadAllText((Join-Path $Dir $file), [System.Text.UTF8Encoding]::new($false))
    $lines = $text.Split("`n")
    if (-not $text.EndsWith("`n") -and $text.Length -gt 0) {
        Add-Problem $file $lines.Count $null 'the file does not end with a newline (a torn final line)'
    }
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $raw = $lines[$i]
        $lineNo = $i + 1
        if ($raw -eq '') {
            if ($i -ne $lines.Count - 1) { Add-Problem $file $lineNo $null 'blank line' }
            continue
        }
        try {
            $rec = ConvertFrom-Json -InputObject $raw -AsHashtable -DateKind String
        } catch {
            Add-Problem $file $lineNo $null 'not valid JSON'
            continue
        }
        if (-not (Test-RecordShape $rec)) {
            Add-Problem $file $lineNo $null 'not a valid audit record'
            continue
        }
        $records++
        $seq = [long]$rec['seq']
        if ($seq -ne $prevSeq + 1) { Add-Problem $file $lineNo $seq "seq $seq does not follow $prevSeq" }
        if ($rec['prevHash'] -ne $prevHash) { Add-Problem $file $lineNo $seq 'prevHash does not match the record before it' }
        $body = @{}
        foreach ($k in $rec.Keys) { if ($k -ne 'hash') { $body[$k] = $rec[$k] } }
        if ((Get-Sha256Hex (ConvertTo-Canonical $body)) -ne $rec['hash']) {
            Add-Problem $file $lineNo $seq 'hash does not match the record content'
        }
        if ("audit-$($rec['ts'].Substring(0, [math]::Min(7, $rec['ts'].Length))).jsonl" -ne $file) {
            Add-Problem $file $lineNo $seq "timestamp $($rec['ts']) belongs in a different month file"
        }
        $prevSeq = $seq
        $prevHash = [string]$rec['hash']
    }
}

$headFile = Join-Path $Dir 'head.json'
$head = $null
if (Test-Path -LiteralPath $headFile) {
    try { $head = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($headFile)) -AsHashtable -DateKind String }
    catch { Add-Problem 'head.json' 0 $null 'head.json is not valid JSON' }
} elseif ($records -gt 0) {
    Add-Problem 'head.json' 0 $null 'head.json is missing'
}
if ($null -ne $head) {
    $headSeq = [long]$head['seq']
    if ($headSeq -gt $prevSeq) { Add-Problem 'head.json' 0 $null "the log ends at seq $prevSeq but head.json says ${headSeq}: records were removed from the end" }
    elseif ($headSeq -lt $prevSeq) { Add-Problem 'head.json' 0 $null "head.json is behind the log ($headSeq against $prevSeq)" }
    elseif ($head['hash'] -ne $prevHash) { Add-Problem 'head.json' 0 $null 'head.json hash does not match the last record' }
}

$ok = ($problems.Count -eq 0)
if ($Json) {
    $result = [ordered]@{ ok = $ok; files = $files.Count; records = $records; problems = $problems.ToArray() }
    if ($records -gt 0) { $result['head'] = [ordered]@{ seq = $prevSeq; hash = $prevHash } }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 6 -Compress))
} elseif ($ok) {
    Write-Output "Audit chain OK: $records records in $($files.Count) file(s)."
} else {
    [Console]::Error.WriteLine("Audit chain BROKEN in ${Dir}: $($problems.Count) problem(s).")
    foreach ($p in $problems) { [Console]::Error.WriteLine("  $($p.file):$($p.line): $($p.reason)") }
}
exit $(if ($ok) { 0 } else { 1 })
