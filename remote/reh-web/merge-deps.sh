#!/usr/bin/env bash

set -e

# Error if jq is not installed
if ! command -v jq &> /dev/null
then
	echo "jq could not be found. Please install jq before running this script."
	exit 1
fi

# Combine the remote and web package.json files
# "-s" means "slurp" which reads the entire input into an array
# '*' means multiply the objects, so we merge both sets of dependencies into one file
# If both files have the same dependency, the last one will be used, which is the web package.json
jq -s '.[0] * .[1]' ../package.json ../web/package.json > combined-package.json

# Sort the dependencies alphabetically
sorted_deps=$(jq -r -S '.dependencies' combined-package.json)

# Replace 'dependencies' object in the combined package.json with the sorted dependencies, but keep the rest of the file
jq --argjson sorted_deps "$sorted_deps" '.dependencies = $sorted_deps' combined-package.json > combined-package-deps-sorted.json

# Change the "name" value to "positron-reh-web"
jq '.name = "positron-reh-web"' combined-package-deps-sorted.json > package.json

# Remove the temporary files
rm combined-package.json combined-package-deps-sorted.json

# Done merging dependencies. Run 'yarn' to update the lockfile
echo "Done merging reh-web dependencies! Please commit the package.json and yarn.lock files if they have been updated."
