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

# Staging folders for the old 'node_modules' folders are named with this prefix
# plus a random suffix, so concurrent or successive runs never collide. 'trash'
# is this run's folder; 'trash_pid' is the background job deleting them.
trash_prefix=".rebuild-trash."
trash=""
trash_pid=""

# Is there anything staged for deletion, from this run or an earlier one?
trash_exists() {
	for dir in "${trash_prefix}"*; do
		[ -d "${dir}" ] && return 0
	done
	return 1
}

# Delete the contents of every staging folder in parallel, then the folders.
#
# This deliberately sweeps *all* staging folders, not just this run's, so a
# rebuild that was interrupted hard enough to strand one gets cleaned up by the
# next rebuild. 'rmdir' rather than 'rm -rf' for the folder itself: if anything
# inside it survived, the folder stays behind and the next run retries it.
#
# The subshell ignores the interrupts sent to the rest of the script, so an
# aborted run still finishes cleaning up instead of stranding ~700,000 files.
# The folders disappearing doubles as the "still working" indicator.
start_trash_removal() {
	trash_exists || return 0
	(
		trap '' HUP INT TERM
		for dir in "${trash_prefix}"*; do
			[ -d "${dir}" ] || continue
			find "${dir}" -mindepth 1 -maxdepth 1 -print0 \
				| xargs -0 -n 1 -P 8 rm -rf
			rmdir "${dir}" 2>/dev/null
		done
	) &
	trash_pid=$!
}

# Leave the tree in a known state if the user gives up part way through.
on_interrupt() {
	echo
	if [ -n "${trash_pid}" ] || trash_exists; then
		# Interrupted before the deletion started? Start it now, so the folders
		# already moved aside do not linger.
		[ -n "${trash_pid}" ] || start_trash_removal
		echo "Aborted. The old node_modules folders are still being deleted in the"
		echo "background; the '${trash_prefix}*' folders disappear once that finishes."
	else
		echo "Aborted."
	fi
	exit 130
}
trap on_interrupt HUP INT TERM

# Kill any running deemons.
npm run build-stop

# Remove any existing node_modules folders.
#
# There are dozens of these, holding many hundreds of thousands of small files
# between them, and both figures only grow. Deletion costs per directory entry
# rather than per byte, so a straight 'rm -rf' works through all of them one
# serial unlink() at a time, making it far and away the slowest step here.
# Renaming a directory within the same volume is O(1) no matter how much is
# inside it, though, so move every tree into one staging directory (instant),
# then delete that directory in parallel in the background while 'npm install'
# runs. The deletion is metadata-bound rather than bandwidth-bound, so it
# parallelizes well and overlaps happily with the install.
#
# The 'grep' matters: with '--directory', 'git ls-files' also reports the
# *ancestors* of an ignored folder (a 'pkg/' entry alongside 'pkg/node_modules/')
# whenever that ancestor holds no tracked files. Feeding those straight to 'rm'
# would delete the parent folder too, so keep only the 'node_modules' entries.
# Nothing is lost by filtering, because every folder is also listed in full.
trash=$(mktemp -d "${trash_prefix}XXXXXXXXXX") || exit 1
git ls-files --directory -i -o -x node_modules \
	| sed 's|/$||' \
	| grep -E '(^|/)node_modules$' > "${trash}/folders"

n=0
while read -r folder; do
	n=$((n + 1))
	mv "${folder}" "${trash}/${n}"
done < "${trash}/folders"
rm -f "${trash}/folders"
echo "Moved ${n} node_modules folder(s) aside; deleting them in the background."

start_trash_removal

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

# Wait for the background deletion of the old 'node_modules' folders. By now it
# has almost certainly finished during the installs above. It removes the
# staging folders itself, so there is nothing left to clean up here.
if [ -n "${trash_pid}" ]; then
	echo "Waiting for the old node_modules folders to finish deleting..."
	wait "${trash_pid}"
fi

trap - HUP INT TERM

echo "Done"
