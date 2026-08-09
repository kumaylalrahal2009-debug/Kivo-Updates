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
set KIVO_LOCAL_DESKTOP=true
set KIVO_UPDATE_REPO=kumaylalrahal2009-debug/Kivo-Updates

echo Starting the NEW Kivo build on port %PORT%...
start "Kivo Web Subscription Fix - keep this open" cmd /k "cd /d ""%~dp0"" && set PORT=%PORT% && set KIVO_LOCAL_DESKTOP=%KIVO_LOCAL_DESKTOP% && set KIVO_UPDATE_REPO=%KIVO_UPDATE_REPO% && node --no-warnings server.js"

echo Waiting for Kivo...
for /l %%i in (1,1,15) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:%PORT%/api/admin/me; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto READY
  timeout /t 1 /nobreak >nul
)

echo.
echo Kivo did not start correctly. Check the server window for the error.
pause
exit /b 1

:READY
echo Kivo is ready.
start "" "http://localhost:%PORT%/app?build=sub-control-6"
exit
