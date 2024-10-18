#!/usr/bin/env sh
#
# Copyright (c) Microsoft Corporation. All rights reserved.
#
ROOT="$(dirname "$(dirname "$(dirname "$(readlink -f "$0")")")")"

APP_NAME="@@APPNAME@@"
# --- Start Positron ---
POSITRON_VERSION="@@POSITRONVERSION@@"
BUILD_NUMBER="@@BUILDNUMBER@@"
# --- End Positron ---
VERSION="@@VERSION@@"
COMMIT="@@COMMIT@@"
EXEC_NAME="@@APPNAME@@"
CLI_SCRIPT="$ROOT/out/server-cli.js"
"$ROOT/node" "$CLI_SCRIPT" "$APP_NAME" "$POSITRON_VERSION" "$BUILD_NUMBER" "$VERSION" "$COMMIT" "$EXEC_NAME" "--openExternal" "$@"
