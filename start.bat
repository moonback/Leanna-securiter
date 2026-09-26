@echo off
title Leanna 
echo.
echo   [44m[97m        Leanna         [0m
echo   [90mInitializing System...[0m
echo.

:: Verifier que Node.js est installe
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo   [91m[ERROR][0m Node.js not found. Please install it to continue.
    echo   [90mhttps://nodejs.org/[0m
    echo.
    pause
    exit /b 1
)

:: Aller dans le repertoire du script
cd /d "%~dp0"

:: Installer les dependances si node_modules n'existe pas
if not exist "node_modules\" (
    echo   [94m[INFO][0m Installing dependencies...
    call npm install >nul
    echo.
)

:: Lancer l'application desktop (serveur + Electron)
echo   [92m[START][0m Launching Leanna ...
echo.
call npm run desktop

pause