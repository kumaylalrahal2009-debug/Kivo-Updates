@echo off
setlocal
cd /d "%~dp0"
title Kivo Launcher

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Kivo needs Node.js 22 or newer.
  echo Install Node.js, then launch Kivo again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo.
  echo Kivo needs Node.js 22 or newer. Installed:
  node -v
  echo.
  pause
  exit /b 1
)

set PORT=8488
set KIVO_LOCAL_DESKTOP=true
set KIVO_UPDATE_REPO=kumaylalrahal2009-debug/Kivo-Updates
set "KIVO_DATA_DIR=%~dp0data"
set "KIVO_UPLOAD_DIR=%~dp0uploads"

REM Create private owner credentials on the first local launch.
if not exist "%~dp0business-config.bat" if exist "%~dp0ensure-local-config.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-local-config.ps1" -AppDir "%~dp0"
)

REM Private business/payment/AI/admin settings. Never upload this file.
if exist "%~dp0business-config.bat" call "%~dp0business-config.bat"

if not exist "%KIVO_DATA_DIR%" mkdir "%KIVO_DATA_DIR%"
if not exist "%KIVO_UPLOAD_DIR%" mkdir "%KIVO_UPLOAD_DIR%"

REM Reuse an already-running Kivo instead of creating duplicate service layers.
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:%PORT%/api/admin/me; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo Kivo is already running. Opening it now...
  start "" "http://localhost:%PORT%/app?build=smart-2"
  exit
)

echo.
echo Starting Kivo Smart Experience v2...
echo Local app: http://localhost:%PORT%
echo.
if defined OPENAI_API_KEY (
  echo Intelligence: Cloud AI + Smart Local fallback
) else (
  echo Intelligence: Smart Local v2
)
if defined KIVO_ADMIN_PASSWORD (
  echo Owner admin: configured privately
) else (
  echo Owner admin: setup required
)
if defined STRIPE_SECRET_KEY (
  echo Business billing: configured
) else (
  echo Business billing: demo mode
)
echo.

start "Kivo - keep this open" cmd /k "cd /d ""%~dp0"" && set PORT=%PORT% && set KIVO_LOCAL_DESKTOP=%KIVO_LOCAL_DESKTOP% && set KIVO_UPDATE_REPO=%KIVO_UPDATE_REPO% && set ""KIVO_DATA_DIR=%KIVO_DATA_DIR%"" && set ""KIVO_UPLOAD_DIR=%KIVO_UPLOAD_DIR%"" && node --no-warnings smart-experience-v2.js"

echo Waiting for Kivo...
for /l %%i in (1,1,35) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:%PORT%/api/admin/me; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto READY
  timeout /t 1 /nobreak >nul
)

echo.
echo Kivo did not start correctly.
echo Check the Kivo server window for the exact error.
pause
exit /b 1

:READY
echo Kivo is ready.
start "" "http://localhost:%PORT%/app?build=smart-2"
exit
