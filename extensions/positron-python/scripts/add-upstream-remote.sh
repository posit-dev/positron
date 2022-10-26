#!/usr/bin/env bash

set -e

git remote add upstream git@github.com:microsoft/vscode-python.git
git remote set-url --push upstream DISABLE

echo "Added microsoft/vscode-python as upstream remote (push disabled)."
