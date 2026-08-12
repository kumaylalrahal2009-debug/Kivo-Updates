param(
  [Parameter(Mandatory=$true)][string]$Zip,
  [Parameter(Mandatory=$true)][string]$AppDir,
  [Parameter(Mandatory=$true)][int]$ServerPid
)

$ErrorActionPreference = "Stop"
$updateDir = Join-Path $AppDir "updates"
New-Item -ItemType Directory -Force -Path $updateDir | Out-Null
$logFile = Join-Path $updateDir "update.log"

function Write-UpdateLog([string]$Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Add-Content -Path $logFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Start-Kivo {
  $launcher = Join-Path $AppDir "start-kivo.bat"
  if (Test-Path $launcher) {
    Start-Process "cmd.exe" -ArgumentList "/c `"$launcher`""
  }
}

Write-UpdateLog "Starting update from $Zip"

# Wait for the outer Kivo process to stop before replacing application files.
for ($i = 0; $i -lt 40; $i++) {
  $p = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
  if (-not $p) { break }
  Start-Sleep -Milliseconds 500
}

$temp = Join-Path $env:TEMP ("kivo-update-" + [guid]::NewGuid().ToString("N"))
$backupRoot = Join-Path $AppDir "backups"
$backup = Join-Path $backupRoot (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Force -Path $temp | Out-Null
New-Item -ItemType Directory -Force -Path $backup | Out-Null

$rollbackNames = @(
  "server.js",
  "bootstrap.js",
  "experience.js",
  "smart-experience.js",
  "smart-experience-v2.js",
  "lib",
  "public",
  "version.json",
  "start-kivo.bat",
  "start-admin.bat",
  "apply-update.ps1",
  "BILLING_SETUP.md"
)

function Restore-Rollback {
  Write-UpdateLog "Update failed. Restoring rollback copy from $backup"
  foreach ($name in $rollbackNames) {
    $saved = Join-Path $backup $name
    if (Test-Path $saved) {
      $destination = Join-Path $AppDir $name
      if (Test-Path $destination) { Remove-Item $destination -Recurse -Force -ErrorAction SilentlyContinue }
      Copy-Item $saved $destination -Recurse -Force
    }
  }
}

try {
  # Keep a database copy as a convenience for local builds.
  $dataDb = Join-Path $AppDir "data\kivo.db"
  if (Test-Path $dataDb) {
    Copy-Item $dataDb (Join-Path $backup "kivo.db") -Force
  }

  # Snapshot the currently installed application so a bad update can roll back.
  foreach ($name in $rollbackNames) {
    $source = Join-Path $AppDir $name
    if (Test-Path $source) {
      Copy-Item $source (Join-Path $backup $name) -Recurse -Force
    }
  }

  Expand-Archive -Path $Zip -DestinationPath $temp -Force

  # If package has one wrapper folder, enter it automatically.
  $entries = @(Get-ChildItem $temp)
  $sourceRoot = $temp
  if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    $sourceRoot = $entries[0].FullName
  }

  # Refuse to touch the installation if this is not a complete Kivo package.
  $required = @(
    "start-kivo.bat",
    "smart-experience-v2.js",
    "lib\update-engine.js",
    "public\index.html",
    "public\app.js",
    "public\styles.css",
    "version.json"
  )
  foreach ($relative in $required) {
    if (-not (Test-Path (Join-Path $sourceRoot $relative))) {
      throw "Update package is incomplete. Missing $relative"
    }
  }

  # Syntax-check the update before replacing the running installation.
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    foreach ($relative in @("server.js","bootstrap.js","experience.js","smart-experience-v2.js","lib\update-engine.js","public\app.js","public\premium.js","public\smart-client.js")) {
      $candidate = Join-Path $sourceRoot $relative
      if (Test-Path $candidate) {
        & node --check $candidate
        if ($LASTEXITCODE -ne 0) { throw "JavaScript validation failed for $relative" }
      }
    }
  }

  # Runtime/private assets are never replaced by an application release.
  $protected = @("data","uploads","updates","backups",".git",".env","business-config.bat")
  Get-ChildItem $sourceRoot | ForEach-Object {
    if ($protected -notcontains $_.Name) {
      $destination = Join-Path $AppDir $_.Name
      if (Test-Path $destination) {
        Remove-Item $destination -Recurse -Force
      }
      Copy-Item $_.FullName $destination -Recurse -Force
    }
  }

  # Verify the installed copy before attempting to relaunch it.
  foreach ($relative in $required) {
    if (-not (Test-Path (Join-Path $AppDir $relative))) {
      throw "Installed update failed verification. Missing $relative"
    }
  }

  $installedVersion = "unknown"
  try { $installedVersion = (Get-Content (Join-Path $AppDir "version.json") -Raw | ConvertFrom-Json).version } catch {}
  Write-UpdateLog "Update installed successfully: $installedVersion"

  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $Zip -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700
  Start-Kivo
}
catch {
  Write-UpdateLog "ERROR: $($_.Exception.Message)"
  try { Restore-Rollback } catch { Write-UpdateLog "ROLLBACK ERROR: $($_.Exception.Message)" }
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $Zip -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700
  Start-Kivo
  exit 1
}
