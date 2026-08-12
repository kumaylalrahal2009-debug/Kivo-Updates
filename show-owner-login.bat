@echo off
cd /d "%~dp0"
if exist "owner-login.txt" (
  type "owner-login.txt"
) else (
  echo.
  echo Kivo owner login file was not found.
  echo Launch Kivo once to create the local owner configuration,
  echo or set KIVO_ADMIN_EMAIL and KIVO_ADMIN_PASSWORD in business-config.bat.
)
echo.
pause
