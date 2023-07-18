#!/bin/bash

VERSION=$(node --version)
CURRENT_MAJOR=$(echo $VERSION | cut -d. -f1 | grep -o "\d*")
CURRENT_MINOR=$(echo $VERSION | cut -d. -f2)

RECOMMENDED_VERSION=$(cat .nvmrc)
RECOMMENDED_MAJOR=$(echo $RECOMMENDED_VERSION | cut -d. -f1)
RECOMMENDED_MINOR=$(echo $RECOMMENDED_VERSION | cut -d. -f2)

if [[ "$CURRENT_MAJOR" == "$RECOMMENDED_MAJOR" && "$CURRENT_MINOR" == "$RECOMMENDED_MINOR" ]] ; then
	echo "Node version: $VERSION"
elif [[ "$CURRENT_MAJOR" == "$RECOMMENDED_MAJOR" ]] ; then
	echo "Node version: $VERSION ($RECOMMENDED_VERSION is recommended)"
else # major version mismatch; print a warning in red
	echo -e "\e[31mNode version: $VERSION may not be supported\e[0m"
	echo -e "\e[31mConsider using node version $RECOMMENDED_VERSION\e[0m"
fi
