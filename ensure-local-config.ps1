param([string]$AppDir = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$config = Join-Path $AppDir 'business-config.bat'
$loginFile = Join-Path $AppDir 'owner-login.txt'

if (Test-Path $config) { exit 0 }

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

Write-Host "Created private local Kivo owner configuration."
Write-Host "Owner login saved to: $loginFile"
