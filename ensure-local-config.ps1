param([string]$AppDir = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$config = Join-Path $AppDir 'business-config.bat'
$loginFile = Join-Path $AppDir 'owner-login.txt'

function Protect-PrivateFile([string]$Path) {
  try {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)

    foreach ($rule in @($acl.Access)) {
      [void]$acl.RemoveAccessRuleAll($rule)
    }

    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
    $adminsSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
    $rights = [System.Security.AccessControl.FileSystemRights]::FullControl
    $allow = [System.Security.AccessControl.AccessControlType]::Allow

    foreach ($sid in @($currentUser, $systemSid, $adminsSid)) {
      $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $rights, $allow)
      $acl.AddAccessRule($accessRule)
    }
    $acl.SetOwner($currentUser)
    Set-Acl -LiteralPath $Path -AclObject $acl
  }
  catch {
    Write-Warning "Kivo created $Path but could not tighten its Windows file permissions: $($_.Exception.Message)"
  }
}

if (Test-Path $config) { exit 0 }

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')

@"
@echo off
REM Private Kivo configuration generated locally. Do not upload this file.
set "KIVO_ADMIN_EMAIL=owner@kivo.local"
set "KIVO_ADMIN_PASSWORD=$password"
set "OPENAI_API_KEY="
set "KIVO_AI_MODEL=gpt-5-mini"
set "KIVO_AI_TIMEOUT_MS=8500"
"@ | Set-Content -Path $config -Encoding ASCII

@"
KIVO LOCAL OWNER LOGIN

Email: owner@kivo.local
Password: $password

This file was generated only on this computer.
Delete owner-login.txt after saving the password somewhere private if you prefer.
The actual app configuration is stored in business-config.bat.
"@ | Set-Content -Path $loginFile -Encoding UTF8

Protect-PrivateFile $config
Protect-PrivateFile $loginFile

Write-Host "Created private local Kivo owner configuration."
Write-Host "Owner login saved to: $loginFile"
Write-Host "Windows file permissions were restricted to the current user, SYSTEM and local Administrators where supported."
