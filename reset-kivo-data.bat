@echo off
cd /d "%~dp0"
echo This removes all LOCAL Kivo accounts, tasks and saved uploads on this copy.
choice /M "Reset Kivo local data"
if errorlevel 2 exit /b
if exist data\kivo.db del /q data\kivo.db
if exist uploads rmdir /s /q uploads
mkdir uploads
echo Kivo local data has been reset.
pause
