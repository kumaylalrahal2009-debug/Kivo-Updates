@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Kivo needs Node.js 22 or newer.
  echo.
  pause
  exit /b 1
)

set PORT=8488
set KIVO_BILLING_PORT=8490
set KIVO_CORE_PORT=8491
set KIVO_LOCAL_DESKTOP=true
set KIVO_UPDATE_REPO=kumaylalrahal2009-debug/Kivo-Updates
set "KIVO_DATA_DIR=%~dp0data"
set "KIVO_UPLOAD_DIR=%~dp0uploads"

REM Optional private business/payment settings. This file must never be uploaded to GitHub.
if exist "%~dp0business-config.bat" call "%~dp0business-config.bat"

if not exist "%KIVO_DATA_DIR%" mkdir "%KIVO_DATA_DIR%"
if not exist "%KIVO_UPLOAD_DIR%" mkdir "%KIVO_UPLOAD_DIR%"

echo Starting Kivo on port %PORT%...
echo Accounts and saved data persist in: %KIVO_DATA_DIR%
if defined STRIPE_SECRET_KEY (
  echo Business billing: configured
) else (
  echo Business billing: demo mode - see BILLING_SETUP.md
)
start "Kivo - keep this open" cmd /k "cd /d ""%~dp0"" && set PORT=%PORT% && set KIVO_BILLING_PORT=%KIVO_BILLING_PORT% && set KIVO_CORE_PORT=%KIVO_CORE_PORT% && set KIVO_LOCAL_DESKTOP=%KIVO_LOCAL_DESKTOP% && set KIVO_UPDATE_REPO=%KIVO_UPDATE_REPO% && set ""KIVO_DATA_DIR=%KIVO_DATA_DIR%"" && set ""KIVO_UPLOAD_DIR=%KIVO_UPLOAD_DIR%"" && node --no-warnings experience.js"

echo Waiting for Kivo...
for /l %%i in (1,1,25) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:%PORT%/api/admin/me; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto READY
  timeout /t 1 /nobreak >nul
)

echo.
echo Kivo did not start correctly. Check the Kivo server window for the error.
pause
exit /b 1

:READY
echo Kivo is ready.
start "" "http://localhost:%PORT%/app?build=experience-3"
exit
