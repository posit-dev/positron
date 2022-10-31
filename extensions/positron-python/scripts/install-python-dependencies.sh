#!/usr/bin/env bash

# Get the root directory of the repository from Git
ROOT_DIR=$(git rev-parse --show-toplevel)

# Does the "python" command exist on the path?
if ! command -v python &> /dev/null
then
    if ! command -v python3 &> /dev/null
    then
        # Can't find Python or Python 3, so exit
        echo "Cannot find python or python3 on the path (needed to install dependencies)"
        exit 1
    else
        # We have python3, but not python. For the purposes of dependecy installation, use python3 by creating a symlink in the temporary folder and then adding the temporary folder to $PATH.
        TMP_DIR=$(mktemp -d)
        PYTHON3_PATH=$(command -v python3)
        ln -s $PYTHON3_PATH $TMP_DIR/python
        echo "NOTE: Using ${PYTHON3_PATH} to provide python"
        PATH=$TMP_DIR:$PATH
    fi
fi

# Install dependencies using yarn
pushd $ROOT_DIR
yarn gulp installPythonLibs
popd

# Clean up the temporary folder
if [ -n "$TMP_DIR" ]
then
    rm -rf $TMP_DIR
fi

