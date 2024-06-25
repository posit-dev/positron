#---------------------------------------------------------------------------------------------
#  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#---------------------------------------------------------------------------------------------

# Runs a command repeatedly until it succeeds, until a maximum number of attempts (default 3).

param (
    [int]$maxAttempts = 3,
    [string]$command
)

if (-not $command) {
    Write-Host "Error: You must specify a command to run."
    exit 1
}

$attempt = 0
$success = $false

while ($attempt -lt $maxAttempts -and -not $success) {
    try {
        $attempt++

        Invoke-Expression $command
        $success = $true
    }
    catch {
        # If the command fails, output an error message
        Write-Host "Command '$command' failed on attempt $attempt of $maxAttempts"
    }
}

# Check if the command was successful after the maximum attempts
if (-not $success) {
    Write-Host "Command '$command' failed after $maxAttempts attempts"
}

