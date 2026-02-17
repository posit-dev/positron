#!/bin/bash
# Waits for all three build daemons (watch-client, watch-extensions, watch-e2e) to reach idle state.
# Exits 0 if all daemons are idle, non-zero if any daemon fails.

node scripts/deemon-status.mjs \
	--name watch-client \
	--begins "Starting compilation\.\.\." \
	--ends "Finished compilation with" \
	--command "npm run watch-client" &
pid1=$!

node scripts/deemon-status.mjs \
	--name watch-extensions \
	--begins "Starting compilation" \
	--ends "Finished compilation" \
	--command "npm run watch-extensions" &
pid2=$!

node scripts/deemon-status.mjs \
	--begins '\[watch-e2e\] \d+:\d+:\d+ [AP]M - (Starting compilation|File change detected\. Starting incremental compilation)' \
	--ends '\[watch-e2e\] \d+:\d+:\d+ [AP]M - Found [0-9]+ errors?\. Watching for file changes' \
	--command "npm run watch-e2e" &
pid3=$!

wait $pid1
r1=$?
wait $pid2
r2=$?
wait $pid3
r3=$?

exit $((r1 || r2 || r3))
