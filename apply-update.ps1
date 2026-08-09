param(
  [Parameter(Mandatory=$true)][string]$Zip,
  [Parameter(Mandatory=$true)][string]$AppDir,
  [Parameter(Mandatory=$true)][int]$ServerPid
)

$ErrorActionPreference = "Stop"

# Wait for the current Node server to fully exit.
for ($i = 0; $i -lt 30; $i++) {
  $p = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
  if (-not $p) { break }
  Start-Sleep -Milliseconds 500
}

$temp = Join-Path $env:TEMP ("kivo-update-" + [guid]::NewGuid().ToString("N"))
$backupRoot = Join-Path $AppDir "backups"
$backup = Join-Path $backupRoot (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Force -Path $temp | Out-Null
New-Item -ItemType Directory -Force -Path $backup | Out-Null

# Keep a small rollback copy of app code, never user data.
foreach ($name in @("server.js","public","version.json","start-kivo.bat","start-admin.bat","apply-update.ps1")) {
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

# Never overwrite runtime/private folders.
$protected = @("data","uploads","updates","backups",".git",".env")
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

Start-Sleep -Milliseconds 500
Start-Process "cmd.exe" -ArgumentList "/c `"$AppDir\start-kivo.bat`""
