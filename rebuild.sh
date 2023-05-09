#!/usr/bin/env sh

cat <<- EOF
This script will:

- Kill any running build daemons
- Recursively remove any existing 'node_modules' folders
- Remove the '.build' directory
- Remove the 'amalthea' builds
- Rebuild the aforementioned 'node_modules' folders

This will probably take a while, so only run this script if you're stuck and
you need to restart from a fresh slate.

Once this script is done, launch the build tasks using:

- Cmd  + Shift + B (macOS)
- Ctrl + Shift + B (Linux)

from within VSCode.

EOF
read -p 'Do you want to proceed? [y/N]: ' proceed

case "${proceed}" in
[yY]*)	;;
*)
	echo "Operation aborted."
	exit 0
;;
esac

# Kill any running deemons.
yarn run kill-watchd
yarn run kill-watch-webd
yarn run kill-watch-clientd
yarn run kill-watch-extensionsd

# Disabled for now because it hangs. This needs to be investigated, but it's not worth doing right at the moment.
#yarn run kill-watch-build-toolsd

# Remove any existing node_modules folders.
git ls-files --directory -i -o -x node_modules | xargs rm -rf

# Remove the build directory.
rm -rf .build

# Remove the amalthea builds.
rm -rf extensions/positron-r/amalthea/target/debug
rm -rf extensions/positron-r/amalthea/target/release

# Run yarn to rebuild 'node_modules'.
yarn

echo "Done"
