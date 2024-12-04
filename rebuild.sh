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
npm run kill-watchd
npm run kill-watch-webd
npm run kill-watch-clientd
npm run kill-watch-extensionsd

# Remove any existing node_modules folders.
git ls-files --directory -i -o -x node_modules | xargs rm -rf

# Remove the build directory.
rm -rf .build

# Remove the amalthea builds.
rm -rf extensions/positron-r/amalthea/target/debug
rm -rf extensions/positron-r/amalthea/target/release

# Run npm install to rebuild 'node_modules'.
npm install

echo "Done"
