Write-Host @"
This script will:

- Kill any running build daemons,
- Recursively remove any existing 'node_modules' folders,
- Remove the '.build' directory,
- Rebuild the aforementioned 'node_modules' folders,
- Re-compile the existing Typescript source.

This will probably take a while, so only run this script
if you're stuck and you need to restart from a fresh slate.

After running this script, you can run the build task in
Visual Studio Code using ⇧⌘B (macOS) or Ctrl+Shift+B (Windows).

"@

$confirmation = Read-Host "Do you want to proceed? [y/N]"
if ($confirmation -eq 'n') {
	Write-Host "Operation aborted."
    Exit 0
}

# Kill any running deemons.
Write-Host "Killing build daemons..."
yarn run kill-watchd
yarn run kill-watch-webd
yarn run kill-watch-clientd
yarn run kill-watch-extensionsd

# Disabled for now because it hangs. This needs to be investigated, but it's not worth doing right at the moment.
#yarn run kill-watch-build-toolsd

Write-Host "Cleaning up build artifacts..."
git ls-files --directory -i -o -x node_modules | Remove-Item -Recurse -Force
Remove-Item -Recurse -Force .build

Write-Host "Killing build daemons"

# Run yarn to rebuild 'node_modules'.
yarn

Write-Host "Done"
