@echo off

REM ---------------------------------------------------------------------------------------------
REM Copyright (C) 2024 Posit Software, PBC. All rights reserved.
REM ---------------------------------------------------------------------------------------------

REM This script is used to run a program and capture its output to a file. It is
REM used to capture the output of the supervisor process so that it can be displayed
REM in the UI in the case of a startup failure.

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

REM Print the command line to the log file
echo %args% >> "%output_file%"

REM Run the program with its arguments and capture the output
%args% >> "%output_file%"

REM Save the exit code of the program
set exit_code=%ERRORLEVEL%

REM Exit with the same code as the program so that the caller can correctly report errors
exit /b exit_code
