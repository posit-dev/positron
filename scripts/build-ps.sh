#!/bin/bash
# Shows the status of Positron build daemons (watch-clientd, watch-extensionsd, watch-e2ed, watch-copilotd)
set -euo pipefail
exec node scripts/build-ps.mts
