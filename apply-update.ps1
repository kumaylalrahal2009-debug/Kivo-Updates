param(
  [Parameter(Mandatory=$true)][string]$Zip,
  [Parameter(Mandatory=$true)][string]$AppDir,
  [Parameter(Mandatory=$true)][int]$ServerPid
)

$ErrorActionPreference = "Stop"

# Wait for Kivo to stop before replacing application files.
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

# Back up the account database before every update.
$dataDb = Join-Path $AppDir "data\kivo.db"
if (Test-Path $dataDb) {
  Copy-Item $dataDb (Join-Path $backup "kivo.db") -Force
}

# Keep rollback copies of application code, never move user data out of place.
foreach ($name in @("server.js","bootstrap.js","experience.js","public","version.json","start-kivo.bat","start-admin.bat","apply-update.ps1","BILLING_SETUP.md")) {
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

# These are runtime/private assets. GitHub updates must never replace them.
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

Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $Zip -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 800
Start-Process "cmd.exe" -ArgumentList "/c `"$AppDir\start-kivo.bat`""
