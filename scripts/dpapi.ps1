# Protects or unprotects bytes with Windows DPAPI, current user scope. Bytes in and out are base64 on stdin and stdout.
# The Host uses this for the Relay device token and its own private key, so neither sits on disk in the clear.
param([Parameter(Mandatory)][ValidateSet('protect', 'unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
# PowerShell 7 has the class in its own assembly; Windows PowerShell 5.1 (.NET Framework) has it in System.Security.
try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData } catch { Add-Type -AssemblyName System.Security }
$text = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($text)
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($Mode -eq 'protect') { $out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope) }
else { $out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope) }
[Console]::Out.Write([Convert]::ToBase64String($out))
