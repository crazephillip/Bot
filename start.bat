@echo off
title Trading Platform Launcher
cd /d "%~dp0"

echo.
echo ============================================
echo    Trading Platform Launcher
echo ============================================
echo.

REM Kill anything on port 5000
echo [*] Clearing port 5000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000 "') do (
    taskkill /F /PID %%p 2>nul
)
timeout /t 1 /nobreak >nul

REM Start Web Server
echo [*] Starting Web Server...
start "Trading Platform - Web Server" powershell -ExecutionPolicy Bypass -NoExit -File "%~dp0server.ps1"
timeout /t 3 /nobreak >nul

REM Start Options Fetcher
echo [*] Starting Options Fetcher...
start "Trading Platform - Options Fetcher" powershell -ExecutionPolicy Bypass -NoExit -File "%~dp0fetch_options.ps1"

REM Start NBA Fetcher
echo [*] Starting NBA Fetcher...
start "Trading Platform - NBA Fetcher" powershell -ExecutionPolicy Bypass -NoExit -File "%~dp0fetch_nba.ps1"

REM Wait for server to be ready then open browser
echo [*] Waiting for server to start...
timeout /t 4 /nobreak >nul

echo [*] Opening browser...
start "" "http://localhost:5000"

echo.
echo ============================================
echo   Platform is running!
echo.
echo   Options:  http://localhost:5000/options
echo   NBA:      http://localhost:5000/nba
echo.
echo   3 PowerShell windows are running:
echo     - Web Server (port 5000)
echo     - Options Fetcher (every 60s)
echo     - NBA Fetcher (every 15min)
echo.
echo   Close those windows to stop everything.
echo ============================================
echo.
pause
