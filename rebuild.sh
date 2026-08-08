#!/usr/bin/env sh

cat <<- EOF
This script will:

- Kill any running build daemons
- Recursively remove any existing 'node_modules' folders
- Remove the '.build' directory
- Remove the locally built Ark (kernel) binaries
- Remove the prebuilt Ark and Kallichore binaries so they are reinstalled
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
npm run build-stop

# Remove any existing node_modules folders.
git ls-files --directory -i -o -x node_modules | xargs rm -rf

# Remove the build directory.
rm -rf .build

# Remove any locally built Ark (kernel) binaries.
rm -rf extensions/positron-r/ark/target/debug
rm -rf extensions/positron-r/ark/target/release

# Remove the prebuilt binaries installed by the extensions' post-install
# scripts (Ark and Kallichore). These are downloaded (or copied from a local
# build) as a side effect of the install, so removing them here keeps this a
# true clean install and forces the post-install scripts to reinstall them.
rm -rf extensions/positron-r/resources/ark
rm -rf extensions/positron-supervisor/resources/kallichore

# Run npm install to rebuild 'node_modules'.
npm install

# Run 'npm install' for e2e tests.
echo "Installing e2e test dependencies..."
npm --prefix test/e2e install

echo "Done"
