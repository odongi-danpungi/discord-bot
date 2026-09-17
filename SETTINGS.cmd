@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS를 설치한 뒤 다시 실행하세요.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
node scripts/windows-start.js --configure
pause
