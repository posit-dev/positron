#!/usr/bin/env bash

set -e

git remote add upstream git@github.com:microsoft/vscode.git
git remote set-url --push upstream DISABLE

echo "Added microsoft/vscode as upstream remote (push disabled)."


