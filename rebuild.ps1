Write-Host @"
This script will:

- Kill any running build daemons
- Recursively remove any existing 'node_modules' folders
- Remove the '.build' directory
- Rebuild the aforementioned 'node_modules' folders

This will probably take a while, so only run this script if you're stuck and
you need to restart from a fresh slate.

Once this script is done, launch the build tasks using Ctrl+Shift+B on Windows.

"@

$confirmation = Read-Host "Do you want to proceed? [y/N]"
if ($confirmation -eq 'n') {
	Write-Host "Operation aborted."
    Exit 0
}

# Kill any running deemons.
if (Test-Path node_modules\deemon) {
	Write-Host "Killing build daemons..."
	yarn run kill-watchd
	yarn run kill-watch-webd
	yarn run kill-watch-clientd
	yarn run kill-watch-extensionsd

	# Disabled for now because it hangs. This needs to be investigated, but it's not worth doing right at the moment.
	#yarn run kill-watch-build-toolsd
}

Write-Host "Cleaning up build artifacts..."
git ls-files --directory -i -o -x node_modules | Remove-Item -Recurse -Force
if (Test-Path .build) {
	Remove-Item -Recurse -Force .build
}

# Run yarn to rebuild 'node_modules'.
Write-Host "Installing..."
yarn

Write-Host "Done"
