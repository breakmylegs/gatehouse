# Parses PowerShell text with the language parser (nothing is executed) and reports
# every command, redirection, member call and string constant as JSON.
#
#   -Loop  warm worker: reads one JSON request per line ({ "id": n, "b64": "<utf8 base64>" })
#          and writes one JSON line per request. Prints a ready line first.
#   (none) reads all of stdin as the script text and writes one JSON document.
param([switch]$Loop)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$staticTypes = @('ConstantExpressionAst', 'StringConstantExpressionAst', 'TypeExpressionAst')

function Convert-Element($e) {
    $t = $e.GetType().Name
    $dyn = $false
    $val = $e.Extent.Text
    switch ($t) {
        'StringConstantExpressionAst' { $val = $e.Value }
        'ExpandableStringExpressionAst' {
            if ($e.NestedExpressions.Count -gt 0) { $dyn = $true } else { $val = $e.Value }
        }
        'CommandParameterAst' {
            $val = '-' + $e.ParameterName
            if ($null -ne $e.Argument) {
                $inner = Convert-Element $e.Argument
                $val = $val + ':' + $inner.value
                $dyn = $inner.dynamic
            }
        }
        'VariableExpressionAst' {
            $n = $e.VariablePath.UserPath.ToLowerInvariant()
            if (($n -in @('true', 'false', 'null')) -and -not $e.Splatted) { $val = '$' + $n } else { $dyn = $true }
        }
        'ArrayLiteralAst' {
            foreach ($x in $e.Elements) { if ((Convert-Element $x).dynamic) { $dyn = $true } }
        }
        default {
            if ($staticTypes -notcontains $t) { $dyn = $true }
        }
    }
    return @{ type = $t; value = [string]$val; dynamic = $dyn }
}

function Get-Analysis([string]$Text) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($Text, [ref]$tokens, [ref]$errors)
    $commands = New-Object System.Collections.ArrayList
    $redirects = New-Object System.Collections.ArrayList
    $members = New-Object System.Collections.ArrayList
    $strings = New-Object System.Collections.ArrayList

    $found = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
    foreach ($c in $found) {
        $els = New-Object System.Collections.ArrayList
        foreach ($e in $c.CommandElements) { [void]$els.Add((Convert-Element $e)) }
        [void]$commands.Add(@{
                name       = $c.GetCommandName()
                invocation = $c.InvocationOperator.ToString()
                elements   = $els.ToArray()
            })
    }
    $reds = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst] }, $true)
    foreach ($r in $reds) {
        $loc = Convert-Element $r.Location
        [void]$redirects.Add(@{ target = $loc.value; dynamic = $loc.dynamic; append = [bool]$r.Append })
    }
    $calls = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)
    foreach ($m in $calls) {
        [void]$members.Add(@{ member = $m.Member.Extent.Text; target = $m.Expression.Extent.Text; static = [bool]$m.Static })
    }
    $strs = $ast.FindAll({
            param($n)
            ($n -is [System.Management.Automation.Language.StringConstantExpressionAst]) -or
            ($n -is [System.Management.Automation.Language.ExpandableStringExpressionAst])
        }, $true)
    foreach ($s in $strs) { [void]$strings.Add([string]$s.Value) }

    return [ordered]@{
        ok        = ($errors.Count -eq 0)
        errors    = @($errors | ForEach-Object { $_.Message })
        commands  = $commands.ToArray()
        redirects = $redirects.ToArray()
        members   = $members.ToArray()
        strings   = $strings.ToArray()
    }
}

function Write-Line($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Depth 8 -Compress))
    [Console]::Out.Flush()
}

if ($Loop) {
    Write-Line ([ordered]@{ ready = $true; languageMode = $ExecutionContext.SessionState.LanguageMode.ToString() })
    while ($null -ne ($line = [Console]::In.ReadLine())) {
        if ($line.Trim() -eq '') { continue }
        $id = $null
        try {
            $req = $line | ConvertFrom-Json
            $id = $req.id
            $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($req.b64))
            $res = Get-Analysis $text
            $res['id'] = $id
        } catch {
            $res = [ordered]@{ id = $id; ok = $false; errors = @("$_"); commands = @(); redirects = @(); members = @(); strings = @() }
        }
        Write-Line $res
    }
} else {
    $text = [Console]::In.ReadToEnd()
    Write-Line (Get-Analysis $text)
}
