@echo off
setlocal
cd /d "%~dp0"
title TV Corporativa - Servidor local
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 24 ou superior e abra esta janela novamente.
  echo Consulte docs\COMO-RODAR-NO-WINDOWS.md.
  pause
  exit /b 1
)
echo Mantenha esta janela aberta enquanto utilizar a plataforma.
echo Endereco padrao: http://127.0.0.1:4173
echo Para encerrar, pressione Ctrl+C.
echo.
node --env-file-if-exists=.env server/index.mjs
set "taskExitCode=%errorlevel%"
echo.
pause
exit /b %taskExitCode%
