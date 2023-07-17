#!/usr/bin/env bash

VERSION=$(node --version)
MIN_VERSION=v16.17
MAX_VERSION=v17

echo "Node version: $VERSION"

if [[ "$VERSION" < "$MIN_VERSION" || "$VERSION" == "$MAX_VERSION"* ]] ; then
	echo "Node version is not supported. Please use node version between $MIN_VERSION and $MAX_VERSION"
	exit 1
else
	echo "Node version is supported."
fi
