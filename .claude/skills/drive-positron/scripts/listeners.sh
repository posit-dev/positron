#!/usr/bin/env bash
# Lists the TCP ports open for listening on this machine, with the process that
# owns each, so a run can tell whether a server it started is still running.
# Save the list before launching, then compare after stopping: a port in the
# second list and not the first is a server the run left behind.
#
# Usage:
#   scripts/listeners.sh --save "$RUN/tmp/listeners-before.txt"
#   scripts/listeners.sh --diff "$RUN/tmp/listeners-before.txt"
#   scripts/listeners.sh
#
# Other runs on the machine start and stop servers too, so a new port in the
# diff is only a lead: its PID and command say whether it is yours.
#
# Stdout: one line per listener, "<port> <pid> <command>", sorted by port.
#   With --diff, only the listeners not in the saved list.
# Exit code: 0, or 1 with --diff when there is a new listener.
#
# Required tools on PATH: lsof.

set -u
list() {
	lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { n = split($9, a, ":"); print a[n], $2, $1 }' | sort -u -n
}
case "${1:-}" in
	--save) list > "$2"; wc -l < "$2" | tr -d ' ' | sed 's/$/ listeners saved/' >&2 ;;
	--diff)
		NEW=$(comm -13 <(sort "$2") <(list | sort))
		if [[ -n "$NEW" ]]; then
			printf '%s\n' "$NEW" | sort -n
			exit 1
		fi
		;;
	"") list ;;
	-h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//' ;;
	*) echo "listeners.sh: unknown arg $1" >&2; exit 2 ;;
esac
