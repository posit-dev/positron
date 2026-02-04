#!/bin/bash
set -e

run() {
	local name=$1
	shift
	local cmd="$@"
	if ! result=$($cmd 2>&1); then
		echo "$result"
		exit 1
	fi
	echo "[$name] stopped"
}

run watch-client npx deemon -- --kill npm run watch-client
run watch-extensions npx deemon -- --kill npm run watch-extensions
run watch-e2e npx deemon -- --kill npm run watch-e2e
