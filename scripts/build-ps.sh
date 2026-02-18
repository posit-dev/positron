#!/bin/bash
# Shows the status of Positron build daemons (watch-clientd, watch-extensionsd, watch-e2ed)
set -euo pipefail

DAEMONS=("watch-client" "watch-extensions" "watch-e2e")
PS_OUTPUT=$(ps aux)

printf "%-20s %-10s %-10s %s\n" "DAEMON" "STATUS" "PID" "STARTED"
for daemon in "${DAEMONS[@]}"; do
	line=$(echo "$PS_OUTPUT" | grep -F "$PWD/node_modules/.bin/deemon --daemon npm run ${daemon}" | head -1 || true)
	if [ -n "$line" ]; then
		pid=$(echo "$line" | awk '{print $2}')
		started=$(echo "$line" | awk '{print $9}')
		printf "%-20s %-10s %-10s %s\n" "$daemon" "running" "$pid" "$started"
	else
		printf "%-20s %-10s %-10s %s\n" "$daemon" "stopped" "-" "-"
	fi
done
