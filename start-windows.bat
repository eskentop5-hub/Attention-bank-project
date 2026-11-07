@echo off
chcp 65001 > nul
cd /d "%~dp0"
where node > nul 2> nul || (echo Node.js not found. Install it from https://nodejs.org & pause & exit /b)
start "" /min cmd /c "timeout /t 3 > nul & start http://localhost:3000"
npm start
pause
