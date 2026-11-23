@echo off
setlocal
cd /d "%~dp0"
title TV Corporativa - Primeiro administrador
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 24 ou superior e abra esta janela novamente.
  echo Consulte docs\COMO-RODAR-NO-WINDOWS.md.
  pause
  exit /b 1
)
node --env-file-if-exists=.env scripts/configure.mjs
set "taskExitCode=%errorlevel%"
echo.
pause
exit /b %taskExitCode%
