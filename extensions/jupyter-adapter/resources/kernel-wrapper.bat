REM ---------------------------------------------------------------------------------------------
REM Copyright (C) 2023 Posit Software, PBC. All rights reserved.
REM ---------------------------------------------------------------------------------------------

REM This script is used to run a program and capture its output to a file. It is
REM used to capture the output of the kernel process so that it can be displayed
REM in the UI in the case of a startup failure; it may also be used in the future
REM to perform Positron-specific kernel startup routines, such as setting up
REM environment variables.

@echo off

REM Check that the user provided at least two arguments; the first is the output
REM file and the second is the program to run and any arguments. If not, print a
REM usage message and exit with an error code.

if "%~2"=="" (
  echo Usage: %0 ^<output-file^> ^<program^> [program-args...] >&2
  exit /b 1
)

REM The first argument is the output file; consume it.
set output_file=%1
shift

REM `shift` doesn't affect `%*`, so we have to manually remove the first argument
set "args="
:parse
if "%~1" neq "" (
  set args=%args% %1
  shift
  goto :parse
)
if defined args set args=%args:~1%

REM Start log file with current date
echo *** Log started at %date% %time% > "%output_file%"

REM Print the command line to the log file
echo *** Command line: >> "%output_file%"
echo %args% >> "%output_file%"

REM Unlike `kernel-wrapper.sh`, we do not redirect stdout and stderr to the output file,
REM since this would lock the file and prevent the kernel itself from being able to open the
REM file and log to it, since on Windows only 1 process is allowed to hold write access to a file
REM at any time (https://stackoverflow.com/questions/9337415/how-do-you-have-shared-log-files-under-windows).
REM We generally care about capturing stdout and stderr in the case of startup failure, in which case we
REM might get useful failure information from there, but history has shown us that Windows is not great
REM about emitting problems to the tty, so it probably isn't that useful to try and capture it.
REM https://github.com/posit-dev/positron/issues/1540

REM Run the program with its arguments
%args%

REM Save the exit code of the program
set exit_code=%ERRORLEVEL%

REM Emit the exit code of the program to the log file. Note that there is a log
REM file parser in the Jupyter Adapter that specifically looks for the string
REM "exit code XX" on the last line of the log, so don't change this without
REM updating the parser!
echo *** Log ended at %date% %time% >> "%output_file%"
echo Process exit code %exit_code% >> "%output_file%"

REM Exit with the same code as the program so that the caller can correctly report errors
exit /b exit_code
