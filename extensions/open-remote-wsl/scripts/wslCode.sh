#!/usr/bin/env sh

# ---------------------------------------------------------------------------------------------
#   Copyright (C) 2025 Posit Software, PBC. All rights reserved.
#   Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# --------------------------------------------------------------------------------------------

# Adapted from Microsoft VS Code Remote - WSL

COMMIT=$1
QUALITY=$2
WIN_CODE_CMD=$3
APP_NAME=$4
DATAFOLDER=$5
VERSION=$6
BUILDNUMBER=$7

shift 7

if [ "$VSCODE_WSL_DEBUG_INFO" = true ]; then
	set -x
fi

if [ -z "$DATAFOLDER" ]; then
	DATAFOLDER=".positron-remote"
fi

# Read stdin
if [ ! -t 0 ]; then
	for var in "$@"
	do
		if [ "$var" = "-" ]; then
			PIPE_INPUT_FILE=$(mktemp /tmp/code-stdin-XXX)
			while IFS= read -r line; do
				printf "%s\n" "$line" >> "$PIPE_INPUT_FILE"
			done
		fi
	done
fi

VSCODE_REMOTE_BIN="$HOME/$DATAFOLDER/bin"
AUTHORITY="wsl+default"

if [ "$WSL_DISTRO_NAME" ]; then
	AUTHORITY="wsl+$WSL_DISTRO_NAME"
else
	PROBE=$(mktemp /tmp/vscode-distro-probe.XXXXXX)
	if [ -x "$(command -v wsl.exe)" ]; then
		PROBE_RESULT=$(wsl.exe sh -c "[ -f $PROBE ] && echo 'Found'" | tr -d '\0')
		if [ "$PROBE_RESULT" != "Found" ]; then
			echo "For the current version of WSL, VS Code WSL can be opened from the command line only from the default distro. Use 'wslconfig.exe' to configure the default distro. Alternatively update your version of WSL by updating Windows 10 to the May 19 Update, version 1903.";
			exit 5;
		fi
	else
		echo "wsl.exe not found on PATH, unable to probe whether this is the default distro."
	fi
fi

"$(dirname "$0")/wslDownload.sh" "$COMMIT" "$QUALITY" "$VSCODE_REMOTE_BIN" "${VERSION}-${BUILDNUMBER}"
RC=$?;
if [ $RC -eq 100 ]; then
	echo "Restart download..."
	"$(dirname "$0")/wslDownload.sh" "$COMMIT" "$QUALITY" "$VSCODE_REMOTE_BIN" "${VERSION}-${BUILDNUMBER}";
	RC=$?;
fi
if [ $RC -ne 0 ]; then
	exit $RC
fi

STORED_ENV=$(mktemp /tmp/vscode-distro-env.XXXXXX)
env --null > "$STORED_ENV"

# We keep the VSCODE_* variable names here since they're read by these names in
# the CLI code.
VSCODE_CLIENT_COMMAND="$WIN_CODE_CMD" \
VSCODE_CLIENT_COMMAND_CWD="$(dirname "$0")" \
VSCODE_CLI_AUTHORITY="$AUTHORITY" \
VSCODE_CLI_REMOTE_ENV="$STORED_ENV" \
VSCODE_STDIN_FILE_PATH="$PIPE_INPUT_FILE" \
WSLENV="VSCODE_CLI_REMOTE_ENV/w:$WSLENV" \
"$VSCODE_REMOTE_BIN/$COMMIT/bin/remote-cli/$APP_NAME" "$@"
