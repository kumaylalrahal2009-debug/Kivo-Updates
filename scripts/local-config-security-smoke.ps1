$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$temp = Join-Path $env:TEMP ('kivo-owner-config-ci-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null

function Fail([string]$Message) { throw ('KIVO LOCAL CONFIG TEST FAILED: ' + $Message) }
function Pass([string]$Message) { Write-Host ('PASS: ' + $Message) }

try {
  $setup = Join-Path $root 'ensure-local-config.ps1'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setup -AppDir $temp
  if ($LASTEXITCODE -ne 0) { Fail ('ensure-local-config.ps1 exited with ' + $LASTEXITCODE) }

  $config = Join-Path $temp 'business-config.bat'
  $login = Join-Path $temp 'owner-login.txt'
  if (-not (Test-Path -LiteralPath $config)) { Fail 'business-config.bat was not created' }
  if (-not (Test-Path -LiteralPath $login)) { Fail 'owner-login.txt was not created' }
  Pass 'first-run private owner files are created'

  $configText = Get-Content -LiteralPath $config -Raw
  $loginText = Get-Content -LiteralPath $login -Raw
  $passwordMatch = [regex]::Match($configText, 'KIVO_ADMIN_PASSWORD=([^"\r\n]+)')
  if (-not $passwordMatch.Success) { Fail 'generated admin password is missing from private config' }
  $password = $passwordMatch.Groups[1].Value
  if ($password.Length -lt 30) { Fail ('generated admin password is unexpectedly short (' + $password.Length + ')') }
  if ($loginText -notmatch [regex]::Escape($password)) { Fail 'owner-login.txt does not contain the generated private password' }
  if ($configText -match 'KivoAdmin2026|CHANGE-THIS|REPLACE_ME') { Fail 'starter/default credential text leaked into generated config' }
  Pass 'owner password is random-looking, long and not a starter credential'

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
  foreach ($file in @($config, $login)) {
    $acl = Get-Acl -LiteralPath $file
    if (-not $acl.AreAccessRulesProtected) { Fail ('ACL inheritance is still enabled for ' + $file) }
    foreach ($rule in @($acl.Access)) {
      $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
      if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and $allowed -notcontains $sid) {
        Fail ('unexpected allow ACL ' + $sid + ' on ' + $file)
      }
    }
    $ruleSids = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })
    if ($ruleSids -notcontains $currentSid) { Fail ('current user is missing from protected ACL for ' + $file) }
  }
  Pass 'private owner files have protected ACLs limited to current user, SYSTEM and Administrators'

  $before = (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setup -AppDir $temp
  if ($LASTEXITCODE -ne 0) { Fail 'second first-run config invocation failed' }
  $after = (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
  if ($before -ne $after) { Fail 'existing owner configuration was unexpectedly regenerated' }
  Pass 'existing private owner configuration is never overwritten by first-run setup'

  Write-Host ''
  Write-Host 'Kivo local owner configuration security smoke test passed.'
}
finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
