@echo off
REM ============================================================
REM  KPI Management - rebuild and restart after copying the SWiSH World
REM  single sign-on release (v9.11) over this folder.
REM  Run as Administrator. Nothing is changed until the app's
REM  Windows service has been found.
REM ============================================================
setlocal EnableDelayedExpansion
set APPNAME=KPI Management
set PORT=6010
set HANDOFF=/api/sso/handoff
set SERVICE=
set TASKNAME=SWiSH KPI System
REM SERVICE = the Windows service (NSSM) that runs this app. When it is empty or
REM wrong, the script looks the service up by this folder (NSSM AppDirectory).
REM If that fails too, type the name from services.msc after SERVICE= and rerun.

cd /d "%~dp0" || (echo Cannot open %~dp0 & pause & exit /b 1)
set RUNNER=

if not "%SERVICE%"=="" (
  sc query "%SERVICE%" >nul 2>&1 && set RUNNER=service
)
if "%RUNNER%"=="" (
  set SERVICE=
  for /f "usebackq delims=" %%s in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0redeploy-sso.find-service.ps1"`) do set SERVICE=%%s
  if not "!SERVICE!"=="" set RUNNER=service
)
if "%RUNNER%"=="" if not "%TASKNAME%"=="" (
  schtasks /Query /TN "%TASKNAME%" >nul 2>&1 && set RUNNER=task
)
if "%RUNNER%"=="" goto noservice

echo == 1/4 Stopping %APPNAME% ==
if "%RUNNER%"=="task" (
  echo    scheduled task "%TASKNAME%"
  schtasks /End /TN "%TASKNAME%" >nul 2>&1
  goto killport
)
echo    service %SERVICE%
sc stop "%SERVICE%" >nul 2>&1
set /a tries=0
:waitstop
sc query "%SERVICE%" | find "STOPPED" >nul
if not errorlevel 1 goto killport
set /a tries+=1
if !tries! geq 30 goto killport
timeout /t 2 /nobreak >nul
goto waitstop

:killport
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  echo    stopping leftover process %%p on port %PORT%
  taskkill /F /PID %%p >nul 2>&1
)

echo == 2/4 Installing dependencies ==
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

echo == 3/4 Building ==
call npm run build
if errorlevel 1 goto failed

echo == 4/4 Starting %APPNAME% ==
if "%RUNNER%"=="task" (
  schtasks /Run /TN "%TASKNAME%" >nul
) else (
  sc start "%SERVICE%" >nul
)
set /a tries=0
set CODE=
:waitstart
timeout /t 2 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:%PORT%%HANDOFF% > "%TEMP%\sso-check.txt" 2>nul
set /p CODE=<"%TEMP%\sso-check.txt"
if "!CODE!"=="401" goto started
set /a tries+=1
if !tries! geq 60 goto notup
goto waitstart

:started
echo.
echo Deploy OK - %APPNAME% is up and http://127.0.0.1:%PORT%%HANDOFF% answers 401
echo (401 without a token is the correct answer).
echo Now open SWiSH World ^> Settings ^> Apps ^> this app ^> "Test sign-in as me".
pause
exit /b 0

:notup
echo.
echo *********************************************************
echo  %APPNAME% was started but http://127.0.0.1:%PORT%%HANDOFF%
echo  did not answer 401 within 2 minutes (last answer: "!CODE!").
echo    500   = TASK_HUB_SSO_SECRET is missing from this app's .env
echo    404   = the old build is still running / new files not copied
echo    000   = the app is not listening on port %PORT% yet; check its log
echo *********************************************************
pause
exit /b 1

:noservice
echo.
echo *********************************************************
echo  Could not find the Windows service that runs %APPNAME% from
echo  %~dp0
echo  NOTHING WAS CHANGED.
echo  Open services.msc (or run "nssm list"), find the service, put its
echo  name after SERVICE= at the top of this file and run it again.
echo  If this app is started from a console window or pm2 instead,
echo  follow the manual steps for it in central-task-hub\README-DEPLOY.txt.
echo *********************************************************
pause
exit /b 1

:failed
echo.
echo *********************************************************
echo  INSTALL/BUILD FAILED - %APPNAME% was NOT restarted.
echo  Fix the error above and run this script again.
echo *********************************************************
pause
exit /b 1
