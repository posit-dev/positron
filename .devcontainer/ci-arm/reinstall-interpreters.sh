#!/usr/bin/env bash
# Reinstall the in-tree native interpreter binaries (pet/ark/kcserver) for THIS OS. Run inside the
# container to restore the Linux binaries after a native (macOS) build clobbered them - the symptom
# is Python/R failing to start with "cannot execute binary file: Exec format error", and the
# Doctor's "Interpreters" row flags it. See README "Don't mix container and native builds".
#
# Each binary's VERSION marker is removed first: the installers skip when VERSION matches, so a
# stale marker would otherwise keep the wrong-OS binary in place. Then re-run the per-extension
# installers, which fetch the binary for whichever OS this script runs on.
set -euo pipefail
WS="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$WS"

rm -f extensions/positron-python/python-env-tools/pet extensions/positron-python/resources/pet/VERSION
rm -f extensions/positron-r/resources/ark/ark extensions/positron-r/resources/ark/VERSION
rm -f extensions/positron-supervisor/resources/kallichore/kcserver extensions/positron-supervisor/resources/kallichore/VERSION

npm --prefix extensions/positron-python run install-pet
npm --prefix extensions/positron-r run install-kernel
npm --prefix extensions/positron-supervisor run install-kallichore

echo
echo "Interpreter binaries reinstalled. Restart your Python/R sessions (or reload the window)."
