# ------------------------------------------------------------
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ------------------------------------------------------------

# This script regenerates the Kallichore API client in the Kallichore adapter,
# using an updated version of the Kallichore API definition.
#
# It presumes that Kallichore and Positron are both checked out in the same
# parent directory.


# Ensure that the openapi-generator-cli is installed
if ! command -v openapi-generator &> /dev/null
then
	echo "openapi-generator-cli could not be found. Please install it with 'npm install @openapitools/openapi-generator-cli -g'"
	exit
fi

# Find the directory of this script
SCRIPTDIR=$(cd "$(dirname -- "${BASH_SOURCE[0]}")"; pwd -P)

# Ensure that kallichore.json is where we expect it to be; it should be in a sibling directory of Positron
KALLICHORE_JSON_PATH=$(realpath "${SCRIPTDIR}/../../../../kallichore/kallichore.json")

if [ ! -f "${KALLICHORE_JSON_PATH}" ]; then
	echo "kallichore.json API definition not found"
	exit
fi

# Enter the directory of the Kallichore client source code and generate the API client
pushd "${SCRIPTDIR}/../src/kcclient"

# Generate the API client
openapi-generator generate -i ~/git/kallichore/kallichore.json  -g typescript-axios

# Return to the original directory
popd
