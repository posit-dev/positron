@echo off
setlocal
set ROOT_DIR=%~dp0..\..
@REM --- Start Positron ---
start "Open Browser" /B "%ROOT_DIR%\node.exe" "%ROOT_DIR%\out\server-cli.js" "@@APPNAME@@" "@@POSITRONVERSION@@" "@@BUILDNUMBER@@" "@@VERSION@@" "@@COMMIT@@" "@@APPNAME@@.cmd" "--openExternal" "%*"
@REM --- End Positron ---
endlocal
