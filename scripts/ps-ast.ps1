# Parses PowerShell text with the language parser (nothing is executed) and reports
# every command, redirection, member call and string constant as JSON.
#
#   -Loop  warm worker: reads one JSON request per line ({ "id": n, "b64": "<utf8 base64>" })
#          and writes one JSON line per request. Prints a ready line first.
#   (none) reads all of stdin as the script text and writes one JSON document.
#
# One AstVisitor pass collects everything. (FindAll with script-block predicates calls PowerShell
# code for every node and made each request about 17 ms.)
param([switch]$Loop)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

class GatehouseCollector : System.Management.Automation.Language.AstVisitor {
    [System.Collections.Generic.List[object]] $Commands
    [System.Collections.Generic.List[object]] $Redirects
    [System.Collections.Generic.List[object]] $Members
    [System.Collections.Generic.List[string]] $Strings

    GatehouseCollector() {
        $this.Commands = [System.Collections.Generic.List[object]]::new()
        $this.Redirects = [System.Collections.Generic.List[object]]::new()
        $this.Members = [System.Collections.Generic.List[object]]::new()
        $this.Strings = [System.Collections.Generic.List[string]]::new()
    }

    # Words that are known at parse time. Everything else is dynamic.
    static [hashtable] Convert([System.Management.Automation.Language.Ast] $e) {
        $t = $e.GetType().Name
        $dyn = $false
        $val = $e.Extent.Text
        switch ($t) {
            'StringConstantExpressionAst' { $val = $e.Value }
            'ConstantExpressionAst' { }
            'TypeExpressionAst' { }
            'ExpandableStringExpressionAst' {
                if ($e.NestedExpressions.Count -gt 0) { $dyn = $true } else { $val = $e.Value }
            }
            'CommandParameterAst' {
                $val = '-' + $e.ParameterName
                if ($null -ne $e.Argument) {
                    $inner = [GatehouseCollector]::Convert($e.Argument)
                    $val = $val + ':' + $inner.value
                    $dyn = $inner.dynamic
                }
            }
            'VariableExpressionAst' {
                $n = $e.VariablePath.UserPath.ToLowerInvariant()
                if (($n -eq 'true' -or $n -eq 'false' -or $n -eq 'null') -and -not $e.Splatted) { $val = '$' + $n } else { $dyn = $true }
            }
            'ArrayLiteralAst' {
                foreach ($x in $e.Elements) { if ([GatehouseCollector]::Convert($x).dynamic) { $dyn = $true } }
            }
            default { $dyn = $true }
        }
        return @{ type = $t; value = [string]$val; dynamic = $dyn }
    }

    [System.Management.Automation.Language.AstVisitAction] VisitCommand([System.Management.Automation.Language.CommandAst] $ast) {
        $els = [System.Collections.Generic.List[object]]::new()
        foreach ($e in $ast.CommandElements) { $els.Add([GatehouseCollector]::Convert($e)) }
        $this.Commands.Add(@{
                name       = $ast.GetCommandName()
                invocation = $ast.InvocationOperator.ToString()
                elements   = $els
            })
        return [System.Management.Automation.Language.AstVisitAction]::Continue
    }

    [System.Management.Automation.Language.AstVisitAction] VisitFileRedirection([System.Management.Automation.Language.FileRedirectionAst] $ast) {
        $loc = [GatehouseCollector]::Convert($ast.Location)
        $this.Redirects.Add(@{ target = $loc.value; dynamic = $loc.dynamic; append = [bool]$ast.Append })
        return [System.Management.Automation.Language.AstVisitAction]::Continue
    }

    [System.Management.Automation.Language.AstVisitAction] VisitInvokeMemberExpression([System.Management.Automation.Language.InvokeMemberExpressionAst] $ast) {
        $this.Members.Add(@{ member = $ast.Member.Extent.Text; target = $ast.Expression.Extent.Text; static = [bool]$ast.Static })
        return [System.Management.Automation.Language.AstVisitAction]::Continue
    }

    [System.Management.Automation.Language.AstVisitAction] VisitStringConstantExpression([System.Management.Automation.Language.StringConstantExpressionAst] $ast) {
        $this.Strings.Add([string]$ast.Value)
        return [System.Management.Automation.Language.AstVisitAction]::Continue
    }

    [System.Management.Automation.Language.AstVisitAction] VisitExpandableStringExpression([System.Management.Automation.Language.ExpandableStringExpressionAst] $ast) {
        $this.Strings.Add([string]$ast.Value)
        return [System.Management.Automation.Language.AstVisitAction]::Continue
    }
}

function Get-Analysis([string]$Text) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($Text, [ref]$tokens, [ref]$errors)
    $collector = [GatehouseCollector]::new()
    $ast.Visit($collector)
    $messages = [System.Collections.Generic.List[string]]::new()
    foreach ($err in $errors) { $messages.Add([string]$err.Message) }
    return [ordered]@{
        ok        = ($errors.Count -eq 0)
        errors    = $messages
        commands  = $collector.Commands
        redirects = $collector.Redirects
        members   = $collector.Members
        strings   = $collector.Strings
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
