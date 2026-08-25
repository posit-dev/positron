#---------------------------------------------------------------------------------------------
#  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#---------------------------------------------------------------------------------------------

# Runs a command repeatedly until it succeeds, until a maximum number of attempts (default 3).

param (
    [int]$maxAttempts = 3,
    [string]$command,
    # Output matching this pattern indicates a failure that retrying cannot fix,
    # such as a credential Github has rejected. Replaying an npm install that
    # takes the better part of an hour turns a fast failure into a job timeout,
    # so stop as soon as we see one. Pass an empty string to always retry.
    [string]$fatalPattern = 'HTTP 401|HTTP 403|Bad credentials|code E401|code E403'
)

if (-not $command) {
    Write-Host "Error: You must specify a command to run."
    exit 1
}

$attempt = 0
$success = $false

while ($attempt -lt $maxAttempts -and -not $success) {
    $attempt++
    $output = @()

    try {
        # Reset the exit code to 0 before running the command
        $global:LASTEXITCODE = 0

        # Tee the output so it still streams to the log while we keep a copy to
        # check for failures that are not worth retrying. The redirection has to
        # be inside the expression so that it applies to the command itself;
        # redirecting Invoke-Expression would miss the child process's stderr.
        Invoke-Expression "$command 2>&1" | Tee-Object -Variable output

        # Check the return value of the command and set $success to $true if it is successful
        if ($LASTEXITCODE -eq 0) {
            $success = $true
            Write-Host "Command '$command' succeeded"
        } else {
            Write-Host "Command '$command' had exit code $LASTEXITCODE on attempt $attempt of $maxAttempts"
        }
    }
    catch {
        # If the command fails, output an error message
        Write-Host "Command '$command' failed on attempt $attempt of $maxAttempts"
    }

    if ($success) {
        break
    }

    # Coerce each record to a string; a single-line result would otherwise
    # enumerate as individual characters.
    $joinedOutput = (@($output) | ForEach-Object { [string]$_ }) -join "`n"
    if ($fatalPattern -and ($joinedOutput -match $fatalPattern)) {
        Write-Host "Command '$command' failed with a non-retryable error (matched '$fatalPattern'); not retrying."
        break
    }

    if ($attempt -lt $maxAttempts) {
        # Wait 30 seconds before retrying to allow file locks to release
        Start-Sleep -Seconds 30
    }
}

# Check if the command was successful after the maximum attempts
if (-not $success) {
    Write-Host "Command '$command' failed after $attempt attempt(s)"
    exit 1
}
