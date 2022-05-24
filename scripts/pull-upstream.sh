#!/bin/bash

read -r -d '' USAGE <<- EOF
Usage: ./upstream/pull-upstream.sh [branch]

Pull upstream changes from the Code - OSS repository into the Myriac repository.
EOF

if [ "$1" = "--help" ]; then
  printf "%s\n" "${USAGE}"
  exit 0
fi

# get script directory
SCRIPTDIR=$(cd "$(dirname -- "${BASH_SOURCE[0]}")"; pwd -P)

# automatically add upstream remote
# (swallow errors, assuming the remote already exists)
"${SCRIPTDIR}/add-upstream-remote.sh" &> /dev/null

# fail on error
set -e

# determine branch name; default to active branch
if [ -z "$1" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo "Merging upstream branch: ${BRANCH}"
else
  BRANCH="$1"
fi

# fetch remote
git fetch

# don't allow merge unless HEAD is the same branch as the origin
if [ "$(git rev-parse "origin/${BRANCH}")" != "$(git rev-parse HEAD)" ]; then
  echo "ERROR: Can't merge, HEAD is not same commit as origin/${BRANCH}"
  exit 1
fi

# don't allow merge if tree is dirty
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Can't merge, working tree is dirty"
  exit 1
fi

# merge from remote
git fetch upstream
git merge "upstream/${BRANCH}"

