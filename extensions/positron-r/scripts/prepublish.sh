#!/usr/bin/env bash

# Compile the Amalthea-based kernel
SCRIPTDIR=$(cd "$(dirname -- "${BASH_SOURCE[0]}")"; pwd -P)
${SCRIPTDIR}/compile-kernel.sh

