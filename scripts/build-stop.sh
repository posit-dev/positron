#!/bin/bash
set -e

run() {
	local name=$1
	shift
	local cmd="$@"
	if ! result=$($cmd 2>&1); then
		echo "$result"
		return 1
	fi
	echo "[$name] stopped"
}

run watch-client npx deemon -- --kill npm run watch-client &
pid1=$!
run watch-extensions npx deemon -- --kill npm run watch-extensions &
pid2=$!
run watch-e2e npx deemon -- --kill npm run watch-e2e &
pid3=$!

failed=0
wait $pid1 || failed=1
wait $pid2 || failed=1
wait $pid3 || failed=1
exit $failed
