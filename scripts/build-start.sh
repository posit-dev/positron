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
	echo "[$name] started"
}

run watch-client npx deemon -- --detach npm run watch-client
run watch-extensions npx deemon -- --detach npm run watch-extensions
run watch-e2e npx deemon -- --detach npm run watch-e2e
