@echo off
setlocal

title VSCode Dev

pushd %~dp0\..

:: Get electron, compile, built-in extensions
if "%VSCODE_SKIP_PRELAUNCH%"=="" node build/lib/preLaunch.js

for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"nameShort\":.*" product.json') do set NAMESHORT=%%~a
set NAMESHORT=%NAMESHORT: "=%
set NAMESHORT=%NAMESHORT:"=%.exe
set CODE=".build\electron\%NAMESHORT%"

:: Manage built-in extensions
if "%~1"=="--builtin" goto builtin

:: Configuration
set NODE_ENV=development
set VSCODE_DEV=1
set VSCODE_CLI=1
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1

set DISABLE_TEST_EXTENSION="--disable-extension=vscode.vscode-api-tests"
for %%A in (%*) do (
	if "%%~A"=="--extensionTestsPath" (
		set DISABLE_TEST_EXTENSION=""
	)
)

:: Launch Code
%CODE% . %DISABLE_TEST_EXTENSION% %*
:: --- Start Positron ---
:: The changes in this file are meant to propagate exit code
:: so that failed tests cause CI to fail. `code.bat` is invoked
:: by `.vscode-test.js`.
set EXITCODE=%ERRORLEVEL%
:: --- End Positron ---
goto end

:builtin
%CODE% build/builtin
:: --- Start Positron ---
set EXITCODE=%ERRORLEVEL%
:: --- End Positron ---

:end

popd

:: --- Start Positron ---
endlocal & exit /b %EXITCODE%
:: --- End Positron ---
