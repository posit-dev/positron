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
	npm run kill-watchd
	npm run kill-watch-webd
	npm run kill-watch-clientd
	npm run kill-watch-extensionsd
}

Write-Host "Cleaning up build artifacts..."
git ls-files --directory -i -o -x node_modules | Remove-Item -Recurse -Force
if (Test-Path .build) {
	Remove-Item -Recurse -Force .build
}

# Run `npm install` to rebuild 'node_modules'.
Write-Host "Installing..."
npm install

Write-Host "Done"
