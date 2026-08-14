Write-Host @"
This script will:

- Kill any running build daemons
- Recursively remove any existing 'node_modules' folders
- Remove the '.build' directory
- Remove the locally built Ark (kernel) binaries
- Remove the prebuilt Ark and Kallichore binaries so they are reinstalled
- Rebuild the aforementioned 'node_modules' folders

This will probably take a while, so only run this script if you're stuck and
you need to restart from a fresh slate.

Once this script is done, launch the build tasks using Ctrl+Shift+B on Windows.

"@

$confirmation = Read-Host "Do you want to proceed? [y/N]"
if ($confirmation -notmatch '^[yY]') {
	Write-Host "Operation aborted."
    Exit 0
}

# Kill any running deemons.
if (Test-Path node_modules\deemon) {
	Write-Host "Killing build daemons..."
	npm run kill-watch-client-transpiled
	npm run kill-watch-clientd
	npm run kill-watch-extensionsd
	npm run kill-watch-e2ed
}

Write-Host "Cleaning up build artifacts..."
git ls-files --directory -i -o -x node_modules | Remove-Item -Recurse -Force
if (Test-Path .build) {
	Remove-Item -Recurse -Force .build
}

# Remove any locally built Ark (kernel) binaries.
if (Test-Path extensions\positron-r\ark\target\debug) {
	Remove-Item -Recurse -Force extensions\positron-r\ark\target\debug
}
if (Test-Path extensions\positron-r\ark\target\release) {
	Remove-Item -Recurse -Force extensions\positron-r\ark\target\release
}

# Remove the prebuilt binaries installed by the extensions' post-install
# scripts (Ark and Kallichore). These are downloaded (or copied from a local
# build) as a side effect of the install, so removing them here keeps this a
# true clean install and forces the post-install scripts to reinstall them.
if (Test-Path extensions\positron-r\resources\ark) {
	Remove-Item -Recurse -Force extensions\positron-r\resources\ark
}
if (Test-Path extensions\positron-supervisor\resources\kallichore) {
	Remove-Item -Recurse -Force extensions\positron-supervisor\resources\kallichore
}

# Run `npm install` to rebuild 'node_modules'.
Write-Host "Installing..."
npm install

# Run 'npm install' for e2e tests.
Write-Host "Installing e2e test dependencies..."
npm --prefix test/e2e install

Write-Host "Done"
