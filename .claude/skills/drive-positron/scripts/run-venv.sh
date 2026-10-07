#!/usr/bin/env bash
# Makes a Python venv of the run's own, a copy of an existing one, so a run can
# install and uninstall packages without touching a venv other runs use at the
# same time. Link it into the workspace as `.venv`, where Positron finds it.
#
# Usage:
#   scripts/run-venv.sh <dir> [--from <venv>]
#   ln -s "$RUN/tmp/venv" "$WORKSPACE/.venv"
#
#   <dir>         where to make the venv, such as "$RUN/tmp/venv"
#   --from VENV   the venv to copy (default extensions/positron-python/.venv in
#                 the checkout this script is in)
#
# Uses uv: same Python version, same packages at the same versions, from uv's
# cache, so it takes seconds rather than a fresh download.
#
# Stdout: one JSON line, e.g. {"ok":true,"venv":"/.../tmp/venv","python":"3.14.6","packages":182}
# Exit code: 0 when the venv is ready, 1 when it failed, 2 on a usage error.
#
# Required tools on PATH: uv, jq.

set -u
DIR="$(dirname "${BASH_SOURCE[0]}")"
VENV=""
FROM="$(cd "$DIR/../../../.." && pwd)/extensions/positron-python/.venv"
while [[ $# -gt 0 ]]; do
	case "$1" in
		--from)
			# An empty value is a missing one: "$FROM/bin/python" would be /bin/python, the system interpreter.
			if [[ -z "${2-}" ]]; then
				echo '{"ok":false,"error":"--from needs a value: the venv to copy"}'
				exit 2
			fi
			FROM="$2"; shift 2 ;;
		-h|--help) exec node "$DIR/dp.ts" help "$0" ;;
		-*) echo "run-venv.sh: unknown flag $1" >&2; exit 2 ;;
		*)
			if [[ -n "$VENV" ]]; then
				jq -nc --arg a "$1" --arg d "$VENV" '{ok: false, error: ("unexpected argument \"" + $a + "\" after \"" + $d + "\"; give one <dir>, see --help")}'
				exit 2
			fi
			VENV="$1"; shift ;;
	esac
done
if [[ -z "$VENV" ]]; then
	echo '{"ok":false,"error":"give the directory to make the venv in"}'
	exit 2
fi
if [[ ! -x "$FROM/bin/python" ]]; then
	printf '{"ok":false,"error":"no venv at %s"}\n' "$FROM"
	exit 1
fi
if [[ -e "$VENV" ]]; then
	printf '{"ok":false,"error":"%s already exists"}\n' "$VENV"
	exit 1
fi

VERSION=$("$FROM/bin/python" -c 'import platform; print(platform.python_version())')
REQS=$(mktemp)
trap 'rm -f "$REQS"' EXIT
uv pip freeze --python "$FROM/bin/python" > "$REQS" 2>/dev/null || { echo '{"ok":false,"error":"uv pip freeze failed"}'; exit 1; }
uv venv --quiet --python "$FROM/bin/python" "$VENV" || { echo '{"ok":false,"error":"uv venv failed"}'; exit 1; }
uv pip install --quiet --python "$VENV/bin/python" -r "$REQS" || { echo '{"ok":false,"error":"uv pip install failed"}'; exit 1; }
COUNT=$(uv pip freeze --python "$VENV/bin/python" 2>/dev/null | wc -l | tr -d ' ')
jq -cn --arg v "$VENV" --arg p "$VERSION" --argjson n "$COUNT" '{ok: true, venv: $v, python: $p, packages: $n}'
