# Verifies the Gatehouse audit log without Node: an independent implementation of the check in
# packages/shared/src/audit/verify.ts. It recomputes every record's SHA-256 from its own canonical
# JSON, so a bug in one verifier does not hide a problem from the other.
#
#   .\scripts\verify-audit.ps1 [-Dir <folder>] [-Json]
#
# Exit code 0: the chain is intact. 1: problems found. Runs in PowerShell 7.5 or later and in the Windows
# PowerShell 5.1 built into Windows (owner, 4 Nov: no PowerShell version is a hard dependency).
param(
    [string]$Dir = $(if ($env:GATEHOUSE_AUDIT_DIR) { $env:GATEHOUSE_AUDIT_DIR } elseif ($env:GATEHOUSE_DATA_DIR) { Join-Path $env:GATEHOUSE_DATA_DIR 'audit' } else { Join-Path $env:LOCALAPPDATA 'Gatehouse\audit' }),
    [switch]$Json,
    # D-029: the anchors; by default the anchors folder beside the audit folder, when there is one.
    [string]$Anchors = ''
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
    # Windows PowerShell 5.1's reader gives decimal for a number with a fraction or exponent.
    if ($v -is [double] -or $v -is [decimal]) {
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
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
    return ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
}

# One JSON value as dictionaries, arrays, strings, numbers and booleans, with dates left as the strings they are.
# PowerShell 7.5 has ConvertFrom-Json -AsHashtable -DateKind String; Windows PowerShell 5.1 has .NET Framework's own
# JSON reader, which never turns a string into a date.
$script:JsonReader = $null
if ($PSVersionTable.PSEdition -ne 'Core') {
    Add-Type -AssemblyName System.Web.Extensions
    $script:JsonReader = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $script:JsonReader.MaxJsonLength = [int]::MaxValue
    $script:JsonReader.RecursionLimit = 1000
}
function Read-Json([string]$text) {
    if ($null -eq $script:JsonReader) { return ConvertFrom-Json -InputObject $text -AsHashtable -DateKind String }
    return $script:JsonReader.DeserializeObject($text)
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
    # These two lists are the Node schema's (AuditChannel, Verdict.decidedBy); apps/host/test/audit-bundle.test.ts keeps them the same.
    if (-not ($r.ContainsKey('channel') -and $r['channel'] -in @('approver', 'host', 'desktop', 'phone', 'push', 'timeout'))) { return $false }
    if (-not ($r.ContainsKey('latencyMs') -and (Test-IsInteger $r['latencyMs']) -and $r['latencyMs'] -ge 0)) { return $false }
    if (-not ($r.ContainsKey('prevHash') -and (Test-Hex64 $r['prevHash']))) { return $false }
    if (-not ($r.ContainsKey('hash') -and (Test-Hex64 $r['hash']))) { return $false }
    $vd = $r['verdict']
    if ($vd -isnot [System.Collections.IDictionary]) { return $false }
    if (-not ($vd.ContainsKey('outcome') -and $vd['outcome'] -in @('allow', 'deny', 'escalate'))) { return $false }
    foreach ($k in 'ruleId', 'reason', 'policyHash') { if (-not ($vd.ContainsKey($k) -and $vd[$k] -is [string])) { return $false } }
    if (-not ($vd.ContainsKey('risk') -and (Test-IsInteger $vd['risk']) -and $vd['risk'] -ge 0 -and $vd['risk'] -le 100)) { return $false }
    if (-not ($vd.ContainsKey('decidedBy') -and $vd['decidedBy'] -in @('floor', 'rules', 'judge', 'human-desktop', 'human-phone', 'human-push', 'extreme-mode', 'timeout', 'evaluator-unavailable'))) { return $false }
    return $true
}

$prevSeq = [long]0
$prevHash = $genesis
$records = 0
$bySeq = @{}
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
            $rec = Read-Json $raw
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
        $bySeq[$seq] = $rec
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
    try { $head = Read-Json ([System.IO.File]::ReadAllText($headFile)) }
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

# C-011: a signed timeline export. The signature (ECDSA P-256, SHA-256, IEEE P1363) covers timeline.json's bytes
# followed by head.json's; every entry must say what its records say. The same check as verify-timeline.ts.
$timelineFile = Join-Path $Dir 'timeline.json'
if (Test-Path -LiteralPath $timelineFile) {
    $tBytes = [System.IO.File]::ReadAllBytes($timelineFile)
    $hBytes = if (Test-Path -LiteralPath $headFile) { [System.IO.File]::ReadAllBytes($headFile) } else { $null }
    if ($null -eq $hBytes) { Add-Problem 'head.json' 0 $null 'a timeline needs the head.json it was signed with' }
    else {
        try {
            $jwk = Read-Json ([System.IO.File]::ReadAllText((Join-Path $Dir 'timeline-key.json')))
            $fromB64Url = {
                param([string]$s)
                $b = $s.Replace('-', '+').Replace('_', '/')
                switch ($b.Length % 4) { 2 { $b += '==' } 3 { $b += '=' } }
                [Convert]::FromBase64String($b)
            }
            $q = New-Object System.Security.Cryptography.ECPoint
            $q.X = & $fromB64Url $jwk['x']
            $q.Y = & $fromB64Url $jwk['y']
            $p = New-Object System.Security.Cryptography.ECParameters
            $p.Curve = [System.Security.Cryptography.ECCurve+NamedCurves]::nistP256
            $p.Q = $q
            $ec = [System.Security.Cryptography.ECDsa]::Create($p)
            $sig = [Convert]::FromBase64String(([System.IO.File]::ReadAllText((Join-Path $Dir 'timeline.sig'))).Trim())
            $data = New-Object byte[] ($tBytes.Length + $hBytes.Length)
            [Array]::Copy($tBytes, 0, $data, 0, $tBytes.Length)
            [Array]::Copy($hBytes, 0, $data, $tBytes.Length, $hBytes.Length)
            if (-not $ec.VerifyData($data, $sig, [System.Security.Cryptography.HashAlgorithmName]::SHA256)) {
                Add-Problem 'timeline.sig' 0 $null 'the signature does not match timeline.json and head.json, so one of them was changed'
            }
        } catch {
            Add-Problem 'timeline.sig' 0 $null 'the signature or its key could not be read'
        }
    }
    $t = $null
    try { $t = Read-Json ([System.Text.Encoding]::UTF8.GetString($tBytes)) } catch { $t = $null }
    if ($null -eq $t -or $t['version'] -ne 1 -or $t['session'] -isnot [string] -or $null -eq $t['entries']) {
        Add-Problem 'timeline.json' 0 $null 'timeline.json is not a timeline'
    } else {
        $prevEntry = [long]0
        foreach ($e in $t['entries']) {
            $rs = @($e['records'])
            $eSeq = [long]$e['seq']
            if ($rs.Count -eq 0 -or [long]$rs[0] -ne $eSeq) { Add-Problem 'timeline.json' 0 $eSeq "an entry's place is not its first record"; continue }
            if ($eSeq -le $prevEntry) { Add-Problem 'timeline.json' 0 $eSeq 'the entries are not in audit order' }
            $prevEntry = $eSeq
            $last = $null
            $before = [long]0
            foreach ($s in $rs) {
                $r = $bySeq[[long]$s]
                if ($null -eq $r) { Add-Problem 'timeline.json' 0 $eSeq "record $s is not in this export" }
                elseif ($r['session'] -ne $t['session']) { Add-Problem 'timeline.json' 0 $eSeq "record $s belongs to another session" }
                if ([long]$s -le $before) { Add-Problem 'timeline.json' 0 $eSeq "an entry's records are not in order" }
                $before = [long]$s
                if ($null -ne $r) { $last = $r }
            }
            if ($null -ne $last) {
                $v = $last['verdict']
                if ($last['tool'] -ne $e['tool'] -or $v['outcome'] -ne $e['outcome'] -or $v['ruleId'] -ne $e['ruleId'] -or [long]$v['risk'] -ne [long]$e['risk'] -or $v['decidedBy'] -ne $e['decidedBy']) {
                    Add-Problem 'timeline.json' 0 $eSeq 'the entry does not say what its last record says'
                }
            }
        }
    }
}

# D-029: each anchor's signature (ECDSA P-256, SHA-256, IEEE P1363) over its plain text, with the key in key.json,
# and that the record it names still has the hash it anchored. The same check as anchors.ts.
if ($Anchors -eq '') { $Anchors = Join-Path (Split-Path -Parent ([System.IO.Path]::GetFullPath($Dir))) 'anchors' }
$anchorCount = 0
if (Test-Path -LiteralPath $Anchors) {
    $anchorFiles = @(Get-ChildItem -LiteralPath $Anchors -File | Where-Object { $_.Name -match '^anchor-\d+\.json$' } | Sort-Object Name)
    if ($anchorFiles.Count -gt 0) {
        $aec = $null
        try {
            $ajwk = Read-Json ([System.IO.File]::ReadAllText((Join-Path $Anchors 'key.json')))
            $b64u = {
                param([string]$s)
                $b = $s.Replace('-', '+').Replace('_', '/')
                switch ($b.Length % 4) { 2 { $b += '==' } 3 { $b += '=' } }
                [Convert]::FromBase64String($b)
            }
            $aq = New-Object System.Security.Cryptography.ECPoint
            $aq.X = & $b64u $ajwk['x']
            $aq.Y = & $b64u $ajwk['y']
            $ap = New-Object System.Security.Cryptography.ECParameters
            $ap.Curve = [System.Security.Cryptography.ECCurve+NamedCurves]::nistP256
            $ap.Q = $aq
            $aec = [System.Security.Cryptography.ECDsa]::Create($ap)
        } catch {
            Add-Problem 'anchors/key.json' 0 $null "the anchors' key could not be read, so no anchor could be checked"
        }
        foreach ($af in $anchorFiles) {
            $anchorCount++
            $where = "anchors/$($af.Name)"
            $a = $null
            try { $a = Read-Json ([System.IO.File]::ReadAllText($af.FullName)) } catch { $a = $null }
            if ($null -eq $a -or [long]$a['v'] -ne 1 -or -not (Test-IsInteger $a['seq']) -or $a['hash'] -isnot [string] -or $a['sig'] -isnot [string]) {
                Add-Problem $where 0 $null 'not an anchor'
                continue
            }
            $aSeq = [long]$a['seq']
            if ($null -ne $aec) {
                $ok1 = $false
                try {
                    $msg = [System.Text.Encoding]::UTF8.GetBytes("codehouse-anchor-v1`n$aSeq`n$($a['hash'])`n$($a['ts'])")
                    $ok1 = $aec.VerifyData($msg, [Convert]::FromBase64String($a['sig']), [System.Security.Cryptography.HashAlgorithmName]::SHA256)
                } catch { $ok1 = $false }
                if (-not $ok1) { Add-Problem $where 0 $aSeq "the anchor's signature does not verify, so the anchor was changed" }
            }
            $r = $bySeq[$aSeq]
            if ($null -eq $r) { Add-Problem $where 0 $aSeq "record $aSeq, which was anchored, is not in the log" }
            elseif ($r['hash'] -ne $a['hash']) { Add-Problem $where 0 $aSeq "record $aSeq was changed after it was anchored on $($a['ts'])" }
        }
    }
}

$ok = ($problems.Count -eq 0)
if ($Json) {
    $result = [ordered]@{ ok = $ok; files = $files.Count; records = $records; problems = $problems.ToArray() }
    if ($anchorCount -gt 0) { $result['anchors'] = $anchorCount }
    if ($records -gt 0) { $result['head'] = [ordered]@{ seq = $prevSeq; hash = $prevHash } }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 6 -Compress))
} elseif ($ok) {
    Write-Output "Audit chain OK: $records records in $($files.Count) file(s)."
} else {
    [Console]::Error.WriteLine("Audit chain BROKEN in ${Dir}: $($problems.Count) problem(s).")
    foreach ($p in $problems) { [Console]::Error.WriteLine("  $($p.file):$($p.line): $($p.reason)") }
}
exit $(if ($ok) { 0 } else { 1 })
